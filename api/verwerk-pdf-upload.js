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
import parseSteinweg from '../parsers/parseSteinweg.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';
import { sendViaAhqEdge } from '../services/sendViaAhqEdge.js';

function veiligeNaam(s) {
  return String(s || '').replace(/[^\w\s.-]/gi, '').replace(/\s+/g, '_').trim() || 'Onbekend';
}

// Haalt PDF-bijlagen uit een Outlook .msg (binair OLE-formaat).
// Lazy import zodat een eventueel laadprobleem alleen het .msg-pad raakt
// en niet de hele Express-app bij startup laat crashen.
async function bijlagenUitMsg(naam, buffer, exts) {
  const mod = await import('@kenjiuno/msgreader');
  const MsgReader = mod?.default?.default ?? mod?.default ?? mod;
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const reader = new MsgReader(ab);
  const data = reader.getFileData();
  const atts = data?.attachments || [];
  const out = [];
  const re = new RegExp(`\\.(${exts.join('|')})$`, 'i');
  for (const att of atts) {
    const fn = att.fileName || att.fileNameShort || '';
    if (!re.test(fn)) continue;
    const content = reader.getAttachment(att);
    if (content?.content?.length) {
      out.push({ naam: fn, buffer: Buffer.from(content.content) });
    }
  }
  return out;
}

async function bijlagenUitEml(naam, buffer, exts) {
  const parsed = await simpleParser(buffer);
  const re = new RegExp(`\\.(${exts.join('|')})$`, 'i');
  return (parsed.attachments || [])
    .filter(a => re.test(a.filename || ''))
    .filter(a => a.filename !== '05-versions-space.pdf')
    .map(a => ({ naam: a.filename, buffer: a.content }));
}

// Bouw items uit losse Excel-bijlagen: groepeer alle .xlsx van één bron
// als één Steinweg-batch (route1 + optioneel route2). Resterende excels
// worden als losse Steinweg-items toegevoegd.
function steinwegItemsUitExcels(bron, excels) {
  if (excels.length === 0) return [];
  if (excels.length === 1) {
    return [{ type: 'steinweg', naam: excels[0].naam, bron, buffer: excels[0].buffer }];
  }
  const items = [{
    type: 'steinweg', naam: excels[0].naam, bron,
    buffer: excels[0].buffer, buffer2: excels[1].buffer, naam2: excels[1].naam,
  }];
  for (let i = 2; i < excels.length; i++) {
    items.push({ type: 'steinweg', naam: excels[i].naam, bron, buffer: excels[i].buffer });
  }
  return items;
}

// Zet één geüpload bestand om naar een lijst items (pdf of steinweg-batch).
// Een mail (.eml/.msg) wordt uitgepakt naar al zijn PDF- én Excel-bijlagen.
async function naarItems(naam, buffer) {
  const lower = (naam || '').toLowerCase();

  // Outlook .msg (binair) — herkenbaar aan OLE-magic D0 CF 11 E0
  const isMsg = lower.endsWith('.msg') ||
    (buffer.length > 8 && buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0);
  if (isMsg) {
    try {
      const pdfs   = await bijlagenUitMsg(naam, buffer, ['pdf']);
      const excels = await bijlagenUitMsg(naam, buffer, ['xlsx', 'xlsm', 'xls']);
      const items = [
        ...pdfs.map(p => ({ type: 'pdf', naam: p.naam, bron: naam, buffer: p.buffer })),
        ...steinwegItemsUitExcels(naam, excels),
      ];
      if (items.length === 0) return { items: [], fout: `geen PDF- of Excel-bijlagen in mail "${naam}"` };
      return { items };
    } catch (e) {
      return { items: [], fout: `kon Outlook-mail "${naam}" niet lezen: ${e.message}` };
    }
  }

  // .eml (MIME-tekst)
  const isEml = lower.endsWith('.eml') ||
    buffer.slice(0, 200).toString('utf-8').match(/^(from|received|return-path|delivered-to|mime-version):/im);
  if (isEml) {
    try {
      const pdfs   = await bijlagenUitEml(naam, buffer, ['pdf']);
      const excels = await bijlagenUitEml(naam, buffer, ['xlsx', 'xlsm', 'xls']);
      const items = [
        ...pdfs.map(p => ({ type: 'pdf', naam: p.naam || `${veiligeNaam(naam)}_bijlage.pdf`, bron: naam, buffer: p.buffer })),
        ...steinwegItemsUitExcels(naam, excels),
      ];
      if (items.length === 0) return { items: [], fout: `geen PDF- of Excel-bijlagen in mail "${naam}"` };
      return { items };
    } catch (e) {
      return { items: [], fout: `kon mail "${naam}" niet lezen: ${e.message}` };
    }
  }

  // Direct Excel-upload → Steinweg
  if (/\.(xlsx|xlsm|xls)$/i.test(lower)) {
    return { items: [{ type: 'steinweg', naam, bron: naam, buffer }] };
  }

  // Default: PDF
  return { items: [{ type: 'pdf', naam, bron: naam, buffer }] };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const ctx = await requirePermissionOrServiceToken(req, res, 'edit_tarieven', slug, { json: true });
  if (!ctx) return;

  try {
    return await verwerk(req, res, ctx);
  } catch (e) {
    console.error('[verwerk-pdf-upload] onverwachte fout:', e);
    return res.status(500).json({
      ok: false,
      error: 'Onverwachte fout: ' + (e?.message || String(e)),
      stack: (e?.stack || '').split('\n').slice(0, 4).join(' | '),
    });
  }
}

async function verwerk(req, res, ctx) {
  const { bestanden, to, mailen = true } = req.body || {};
  if (!Array.isArray(bestanden) || bestanden.length === 0) {
    return res.status(400).json({ error: 'bestanden[] is verplicht (elk met naam + data_base64)' });
  }

  // 1. Expandeer alle uploads naar een platte lijst items (pdf of steinweg)
  const itemQueue = [];  // { type, naam, bron, buffer, buffer2?, naam2? }
  const resultaten = []; // { bron, naam, ok, easy?, reden? }
  for (const b of bestanden) {
    const naam = b?.naam || 'onbekend';
    if (!b?.data_base64) { resultaten.push({ bron: naam, naam, ok: false, reden: 'data_base64 ontbreekt' }); continue; }
    let buffer;
    try { buffer = Buffer.from(b.data_base64, 'base64'); }
    catch { resultaten.push({ bron: naam, naam, ok: false, reden: 'ongeldige base64' }); continue; }
    if (!buffer.length) { resultaten.push({ bron: naam, naam, ok: false, reden: 'leeg bestand' }); continue; }

    const { items, fout } = await naarItems(naam, buffer);
    if (fout) { resultaten.push({ bron: naam, naam, ok: false, reden: fout }); continue; }
    itemQueue.push(...items);
  }

  // 2. Verwerk elk item → containers → .easy
  const easyItems = [];   // { filename, content, brontype, bronNaam, bronBuffer, rit }
  const gebruikteNamen = new Set();

  for (const item of itemQueue) {
    let containers;
    try {
      if (item.type === 'pdf') {
        containers = await parsePdfToJson(item.buffer);
      } else if (item.type === 'steinweg') {
        // Probeer eerst de doorgegeven configuratie (default: buffer = route1)
        containers = await parseSteinweg({
          route1Buffer: item.buffer,
          route2Buffer: item.buffer2,
          emailBody: '',
          emailSubject: item.bron || item.naam,
        });
        // Single-bestand fallback: als route1 niets oplevert, probeer als route2
        // (bv. een "LEEG RETOUR"-Excel zonder route1/route2 in de naam)
        if ((!containers || containers.length === 0) && item.buffer && !item.buffer2) {
          containers = await parseSteinweg({
            route1Buffer: null,
            route2Buffer: item.buffer,
            emailBody: '',
            emailSubject: item.bron || item.naam,
          });
        }
      }
    } catch (e) {
      resultaten.push({ bron: item.bron, naam: item.naam, ok: false, reden: 'parse-fout: ' + e.message });
      continue;
    }
    if (!Array.isArray(containers) || containers.length === 0) {
      const hint = item.type === 'steinweg'
        ? 'Steinweg-parser gaf geen containers (verkeerde sheet of niet-Steinweg Excel?)'
        : 'parser herkende geen transportopdracht (onbekende klant of leeg)';
      resultaten.push({ bron: item.bron, naam: item.naam, ok: false, reden: hint });
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
          brontype: item.type,
          bronNaam: item.naam,
          bronBuffer: item.buffer,
          rit: container.ritnummer || reference,
        });
        resultaten.push({ bron: item.bron, naam: item.naam, ok: true, easy: easyFilename });
      } catch (e) {
        resultaten.push({ bron: item.bron, naam: item.naam, ok: false, reden: 'XML-fout: ' + e.message });
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
        { filename: item.bronNaam, content: item.bronBuffer },
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
    aantalBronnenVerwerkt: itemQueue.length,
    easyBestanden: easyItems.map(item => ({
      filename: item.filename,
      content_base64: item.content.toString('base64'),
    })),
    resultaten,
    melding: easyItems.length === 0
      ? 'Geen enkele PDF kon verwerkt worden'
      : verzonden
        ? `${easyItems.length} .easy verstuurd naar ${naar} (+ te downloaden)`
        : `${easyItems.length} .easy klaar om te downloaden (mailen ${mailen ? 'mislukt' : 'overgeslagen'})`,
  });
}
