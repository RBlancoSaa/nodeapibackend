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
import MsgReaderPkg from '@kenjiuno/msgreader';
// CJS/ESM interop: de constructor kan op .default zitten.
const MsgReader = MsgReaderPkg?.default ?? MsgReaderPkg;
import { requirePermissionOrServiceToken } from '../utils/auth.js';
import parsePdfToJson from '../services/parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';
import { sendViaAhqEdge } from '../services/sendViaAhqEdge.js';

function veiligeNaam(s) {
  return String(s || '').replace(/[^\w\s.-]/gi, '').replace(/\s+/g, '_').trim() || 'Onbekend';
}

// Haalt PDF-bijlagen uit een Outlook .msg (binair OLE-formaat).
function pdfsUitMsg(naam, buffer) {
  const reader = new MsgReader(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const data = reader.getFileData();
  const atts = data?.attachments || [];
  const pdfs = [];
  for (const att of atts) {
    const fn = att.fileName || att.fileNameShort || '';
    if (!fn.toLowerCase().endsWith('.pdf')) continue;
    const content = reader.getAttachment(att); // { fileName, content: Uint8Array }
    if (content?.content?.length) {
      pdfs.push({ naam: fn, buffer: Buffer.from(content.content), bron: naam });
    }
  }
  return pdfs;
}

// Zet één geüpload bestand om naar een lijst PDF's. Een mail (.eml/.msg) wordt
// uitgepakt naar al zijn PDF-bijlagen; een .pdf gaat er als losse PDF doorheen.
async function naarPdfs(naam, buffer) {
  const lower = (naam || '').toLowerCase();

  // Outlook .msg (binair) — herkenbaar aan OLE-magic D0 CF 11 E0
  const isMsg = lower.endsWith('.msg') ||
    (buffer.length > 8 && buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0);
  if (isMsg) {
    try {
      const pdfs = pdfsUitMsg(naam, buffer);
      if (pdfs.length === 0) return { pdfs: [], fout: `geen PDF-bijlagen in mail "${naam}"` };
      return { pdfs };
    } catch (e) {
      return { pdfs: [], fout: `kon Outlook-mail "${naam}" niet lezen: ${e.message}` };
    }
  }

  // .eml (MIME-tekst)
  const isEml = lower.endsWith('.eml') ||
    buffer.slice(0, 200).toString('utf-8').match(/^(from|received|return-path|delivered-to|mime-version):/im);
  if (isEml) {
    try {
      const parsed = await simpleParser(buffer);
      const pdfs = (parsed.attachments || [])
        .filter(a => (a.filename || '').toLowerCase().endsWith('.pdf') ||
                     (a.contentType || '').includes('pdf'))
        .filter(a => a.filename !== '05-versions-space.pdf')
        .map(a => ({ naam: a.filename || `${veiligeNaam(naam)}_bijlage.pdf`, buffer: a.content, bron: naam }));
      if (pdfs.length === 0) return { pdfs: [], fout: `geen PDF-bijlagen in mail "${naam}"` };
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

  // 2. Verwerk elke PDF afzonderlijk → .easy (elk met zijn bron-PDF)
  const easyItems = [];   // { filename, content: Buffer, pdfNaam, pdfBuffer, rit }
  const gebruikteNamen = new Set();

  for (const pdf of pdfQueue) {
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
        let n = 2;
        while (gebruikteNamen.has(easyFilename)) {
          easyFilename = `Order_${veiligeNaam(reference)}${cntrSuffix}_${laadplaats}_${n++}.easy`;
        }
        gebruikteNamen.add(easyFilename);
        easyItems.push({
          filename: easyFilename,
          content: Buffer.from(xml, 'utf-8'),
          pdfNaam: pdf.naam,
          pdfBuffer: pdf.buffer,
          rit: container.ritnummer || reference,
        });
        resultaten.push({ bron: pdf.bron, naam: pdf.naam, ok: true, easy: easyFilename });
      } catch (e) {
        resultaten.push({ bron: pdf.bron, naam: pdf.naam, ok: false, reden: 'XML-fout: ' + e.message });
      }
    }
  }

  // 3. Mailen — EXACT 1 mail per .easy (EasyTrip verwerkt 1 bestand per mail).
  //    Per mail: het .easy + de bron-PDF. Via AHQ Gmail-SMTP, fallback OAuth.
  let aantalVerzonden = 0;
  let naar = null, viaKanaal = null;
  const mailFouten = [];

  if (mailen && easyItems.length > 0) {
    naar = to || process.env.RECIPIENT_EMAIL || 'easybestanden@tiarotransport.nl';
    for (const item of easyItems) {
      const bijlagen = [
        { filename: item.filename, content: item.content },
        { filename: item.pdfNaam, content: item.pdfBuffer },
      ];
      try {
        await sendViaAhqEdge({
          to: naar,
          subject: `easytrip file - ${item.rit}`,
          text: `Transportopdracht verwerkt: ${item.rit}\n\n✅ ${item.filename}`,
          attachments: bijlagen,
        });
        aantalVerzonden++; viaKanaal = 'ahq-smtp';
      } catch (edgeErr) {
        try {
          await sendEmailWithAttachments({
            ritnummer: item.rit,
            to: naar,
            attachments: bijlagen,
            verwerkingsresultaten: [{ filename: item.filename, parsed: true }],
          });
          aantalVerzonden++; viaKanaal = viaKanaal || 'nodeapi-oauth';
        } catch (oauthErr) {
          mailFouten.push(`${item.filename}: ${edgeErr.message}`);
        }
      }
    }
    if (mailFouten.length) {
      resultaten.push({ bron: 'email', naam: 'verzending', ok: false,
        reden: `${mailFouten.length} mail(s) mislukt — ${mailFouten[0]}` });
    }
  }

  const verzonden = aantalVerzonden > 0;
  return res.json({
    ok: true,
    verzonden,
    aantalVerzonden,
    via: viaKanaal,
    naar,
    aantalEasy: easyItems.length,
    aantalPdfsVerwerkt: pdfQueue.length,
    easyBestanden: easyItems.map(item => ({
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
