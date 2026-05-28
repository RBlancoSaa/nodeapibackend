// api/verwerk-pdf-upload.js
//
// POST /api/verwerk-pdf-upload
//
// Drop-zone variant van de Gmail-flow. Accepteert losse PDF's ÉN hele
// emails (.eml). Voor elke .eml worden de PDF-bijlagen automatisch
// uitgepakt. Elke PDF wordt:
//   1. geparseerd (parsePdfToJson — auto-detecteert de klant uit de tekst)
//   2. omgezet naar .easy XML (generateXmlFromJson)
//
// De .easy-bestanden worden:
//   - teruggegeven in de response als base64 (om te downloaden), en
//   - gemaild naar easybestanden@tiarotransport.nl (via AHQ Gmail-SMTP).
//
// Body (JSON):
//   {
//     bestanden: [{ naam: 'x.pdf'|'x.eml', data_base64: '...' }, ...],
//     to?: string,        // mail-ontvanger; default = RECIPIENT_EMAIL
//     mailen?: boolean    // default true; false = alleen downloaden
//   }
//
// Response:
//   {
//     ok, verzonden, via, naar, aantalEasy,
//     easyBestanden: [{ filename, content_base64 }],
//     resultaten: [{ bron, naam, ok, easy?, reden? }]
//   }

import '../utils/fsPatch.js';
import { simpleParser } from 'mailparser';
import { requirePermissionOrServiceToken } from '../utils/auth.js';
import parsePdfToJson from '../services/parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';
import { sendViaAhqEdge } from '../services/sendViaAhqEdge.js';

function veiligeNaam(s) {
  return String(s || '').replace(/[^\w\s.-]/gi, '').replace(/\s+/g, '_').trim() || 'Onbekend';
}

// Zet één geüpload bestand om naar een lijst PDF's. Een .eml wordt uitgepakt
// naar al zijn PDF-bijlagen; een .pdf gaat er als losse PDF doorheen.
async function naarPdfs(naam, buffer) {
  const lower = (naam || '').toLowerCase();
  const isEml = lower.endsWith('.eml') || lower.endsWith('.msg') ||
    buffer.slice(0, 200).toString('utf-8').match(/^(from|received|return-path|delivered-to|mime-version):/im);

  if (isEml) {
    try {
      const parsed = await simpleParser(buffer);
      const pdfs = (parsed.attachments || [])
        .filter(a => (a.filename || '').toLowerCase().endsWith('.pdf') ||
                     (a.contentType || '').includes('pdf'))
        .filter(a => a.filename !== '05-versions-space.pdf')
        .map(a => ({ naam: a.filename || `${veiligeNaam(naam)}_bijlage.pdf`, buffer: a.content, bron: naam }));
      if (pdfs.length === 0) {
        return { pdfs: [], fout: `geen PDF-bijlagen in mail "${naam}"` };
      }
      return { pdfs };
    } catch (e) {
      return { pdfs: [], fout: `kon mail "${naam}" niet lezen: ${e.message}` };
    }
  }
  // Gewone PDF
  return { pdfs: [{ naam, buffer, bron: naam }] };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const ctx = await requirePermissionOrServiceToken(req, res, 'edit_tarieven', slug, { json: true });
  if (!ctx) return;

  const { bestanden, to, mailen = true } = req.body || {};
  if (!Array.isArray(bestanden) || bestanden.length === 0) {
    return res.status(400).json({ error: 'bestanden[] is verplicht (elk met naam + data_base64)' });
  }

  // 1. Expandeer alle uploads naar een platte lijst PDF's
  const pdfQueue = [];   // { naam, buffer, bron }
  const resultaten = []; // { bron, naam, ok, easy?, reden? }
  for (const b of bestanden) {
    const naam = b?.naam || 'onbekend';
    if (!b?.data_base64) { resultaten.push({ bron: naam, naam, ok: false, reden: 'data_base64 ontbreekt' }); continue; }
    let buffer;
    try { buffer = Buffer.from(b.data_base64, 'base64'); }
    catch { resultaten.push({ bron: naam, naam, ok: false, reden: 'ongeldige base64' }); continue; }
    if (!buffer.length) { resultaten.push({ bron: naam, naam, ok: false, reden: 'leeg bestand' }); continue; }

    const { pdfs, fout } = await naarPdfs(naam, buffer);
    if (fout) { resultaten.push({ bron: naam, naam, ok: false, reden: fout }); continue; }
    pdfQueue.push(...pdfs);
  }

  // 2. Verwerk elke PDF afzonderlijk → .easy
  const easyAttachments = [];   // { filename, content: Buffer }
  const pdfAttachments = [];     // originele PDF's voor de mail
  let eersteRit = null;

  for (const pdf of pdfQueue) {
    pdfAttachments.push({ filename: pdf.naam, content: pdf.buffer });

    let containers;
    try {
      containers = await parsePdfToJson(pdf.buffer);
    } catch (e) {
      resultaten.push({ bron: pdf.bron, naam: pdf.naam, ok: false, reden: 'parse-fout: ' + e.message });
      continue;
    }
    if (!Array.isArray(containers) || containers.length === 0) {
      resultaten.push({ bron: pdf.bron, naam: pdf.naam, ok: false, reden: 'parser herkende geen transportopdracht (onbekende klant of leeg)' });
      continue;
    }

    for (const container of containers) {
      try {
        const xml = await generateXmlFromJson(container);
        const reference = (container.referentie && container.referentie !== '0')
          ? container.referentie
          : (container.ritnummer || 'GeenReferentie');
        const cntrSuffix = container.containernummer ? `_${container.containernummer}` : '';
        const laadplaats = veiligeNaam(container.locaties?.[1]?.naam || container.locaties?.[0]?.naam || 'Onbekend');
        let easyFilename = `Order_${veiligeNaam(reference)}${cntrSuffix}_${laadplaats}.easy`;
        // Voorkom dat twee .easy dezelfde naam krijgen (mail-clients dedupliceren dan)
        let n = 2;
        while (easyAttachments.some(a => a.filename === easyFilename)) {
          easyFilename = `Order_${veiligeNaam(reference)}${cntrSuffix}_${laadplaats}_${n++}.easy`;
        }
        easyAttachments.push({ filename: easyFilename, content: Buffer.from(xml, 'utf-8') });
        eersteRit = eersteRit || (container.ritnummer || reference);
        resultaten.push({ bron: pdf.bron, naam: pdf.naam, ok: true, easy: easyFilename });
      } catch (e) {
        resultaten.push({ bron: pdf.bron, naam: pdf.naam, ok: false, reden: 'XML-fout: ' + e.message });
      }
    }
  }

  // 3. Mailen (optioneel) — via AHQ Gmail-SMTP, fallback OAuth
  let verzonden = false, naar = null, viaKanaal = null;
  if (mailen && easyAttachments.length > 0) {
    naar = to || process.env.RECIPIENT_EMAIL || 'easybestanden@tiarotransport.nl';
    const alleBijlagen = [...easyAttachments, ...pdfAttachments];
    const verwerkt = resultaten.filter(r => r.ok).map(r => `✅ ${r.easy}`);
    const mislukt = resultaten.filter(r => !r.ok).map(r => `⚠️ ${r.naam}: ${r.reden}`);
    const bodyTekst = [
      `Handmatig verwerkte transportopdracht(en) — ${easyAttachments.length} .easy-bestand(en)`,
      '', verwerkt.join('\n'), mislukt.length ? '\n' + mislukt.join('\n') : '',
    ].filter(Boolean).join('\n');

    try {
      await sendViaAhqEdge({
        to: naar,
        subject: `easytrip file - ${eersteRit || 'handmatige upload'}`,
        text: bodyTekst,
        attachments: alleBijlagen,
      });
      verzonden = true; viaKanaal = 'ahq-smtp';
    } catch (edgeErr) {
      try {
        await sendEmailWithAttachments({
          ritnummer: eersteRit || 'handmatige upload',
          to: naar,
          attachments: alleBijlagen,
          verwerkingsresultaten: resultaten.map(r => ({ filename: r.easy || r.naam, parsed: r.ok, reden: r.reden })),
        });
        verzonden = true; viaKanaal = 'nodeapi-oauth';
      } catch (oauthErr) {
        // Mail mislukte, maar download blijft mogelijk — geen harde fout.
        viaKanaal = 'mislukt';
        resultaten.push({ bron: 'email', naam: 'verzending', ok: false,
          reden: `AHQ: ${edgeErr.message} | OAuth: ${oauthErr.message}` });
      }
    }
  }

  return res.json({
    ok: true,
    verzonden,
    via: viaKanaal,
    naar,
    aantalEasy: easyAttachments.length,
    aantalPdfsVerwerkt: pdfQueue.length,
    easyBestanden: easyAttachments.map(a => ({
      filename: a.filename,
      content_base64: a.content.toString('base64'),
    })),
    resultaten,
    melding: easyAttachments.length === 0
      ? 'Geen enkele PDF kon verwerkt worden'
      : verzonden
        ? `${easyAttachments.length} .easy verstuurd naar ${naar} (+ te downloaden)`
        : `${easyAttachments.length} .easy klaar om te downloaden (mailen ${mailen ? 'mislukt' : 'overgeslagen'})`,
  });
}
