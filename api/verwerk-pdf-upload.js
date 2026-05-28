// api/verwerk-pdf-upload.js
//
// POST /api/verwerk-pdf-upload
//
// Drop-zone variant van de Gmail-flow: in plaats van PDF's uit de inbox te
// halen, krijg je ze hier rechtstreeks als upload. Per PDF wordt:
//   1. geparseerd (parsePdfToJson — auto-detecteert de klant uit de tekst)
//   2. omgezet naar .easy XML (generateXmlFromJson)
//   3. verzameld als bijlage
// Daarna wordt ÉÉN email gestuurd met alle .easy-bestanden + originele PDF's
// naar easybestanden@tiarotransport.nl (of een meegegeven `to`).
//
// Body (JSON):
//   {
//     bestanden: [{ naam: 'opdracht.pdf', data_base64: '...' }, ...],
//     to?: 'easybestanden@tiarotransport.nl'   // optioneel, default = RECIPIENT_EMAIL
//   }
//
// Response:
//   {
//     ok, verzonden: boolean, aantalEasy, naar,
//     resultaten: [{ naam, ok, easy?, reden? }]
//   }

import '../utils/fsPatch.js';
import { requirePermissionOrServiceToken } from '../utils/auth.js';
import parsePdfToJson from '../services/parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';
import { sendViaAhqEdge } from '../services/sendViaAhqEdge.js';

function veiligeNaam(s) {
  return String(s || '').replace(/[^\w\s.-]/gi, '').replace(/\s+/g, '_').trim() || 'Onbekend';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const ctx = await requirePermissionOrServiceToken(req, res, 'edit_tarieven', slug, { json: true });
  if (!ctx) return;

  const { bestanden, to } = req.body || {};
  if (!Array.isArray(bestanden) || bestanden.length === 0) {
    return res.status(400).json({ error: 'bestanden[] is verplicht (elk met naam + data_base64)' });
  }

  const resultaten = [];
  const easyAttachments = [];
  const pdfAttachments = [];
  let eersteRit = null;

  for (const b of bestanden) {
    const naam = b?.naam || 'onbekend.pdf';
    if (!b?.data_base64) {
      resultaten.push({ naam, ok: false, reden: 'data_base64 ontbreekt' });
      continue;
    }

    let buffer;
    try {
      buffer = Buffer.from(b.data_base64, 'base64');
    } catch {
      resultaten.push({ naam, ok: false, reden: 'ongeldige base64' });
      continue;
    }
    if (!buffer.length) {
      resultaten.push({ naam, ok: false, reden: 'leeg bestand' });
      continue;
    }
    pdfAttachments.push({ filename: naam, content: buffer });

    let containers;
    try {
      containers = await parsePdfToJson(buffer);
    } catch (e) {
      resultaten.push({ naam, ok: false, reden: 'parse-fout: ' + e.message });
      continue;
    }
    if (!Array.isArray(containers) || containers.length === 0) {
      resultaten.push({ naam, ok: false, reden: 'parser herkende geen transportopdracht (onbekende klant of leeg)' });
      continue;
    }

    for (const container of containers) {
      try {
        const xml = await generateXmlFromJson(container);
        const reference = (container.referentie && container.referentie !== '0')
          ? container.referentie
          : (container.ritnummer || 'GeenReferentie');
        const cntrSuffix = container.containernummer ? `_${container.containernummer}` : '';
        const laadplaats = veiligeNaam(
          container.locaties?.[1]?.naam || container.locaties?.[0]?.naam || 'Onbekend'
        );
        const easyFilename = `Order_${veiligeNaam(reference)}${cntrSuffix}_${laadplaats}.easy`;
        easyAttachments.push({ filename: easyFilename, content: Buffer.from(xml, 'utf-8') });
        eersteRit = eersteRit || (container.ritnummer || reference);
        resultaten.push({ naam, ok: true, easy: easyFilename });
      } catch (e) {
        resultaten.push({ naam, ok: false, reden: 'XML-fout: ' + e.message });
      }
    }
  }

  let verzonden = false;
  let naar = null;
  let viaKanaal = null;
  if (easyAttachments.length > 0) {
    naar = to || process.env.RECIPIENT_EMAIL || 'easybestanden@tiarotransport.nl';
    const alleBijlagen = [...easyAttachments, ...pdfAttachments];
    const verwerkt = resultaten.filter(r => r.ok).map(r => `✅ ${r.easy}`);
    const mislukt = resultaten.filter(r => !r.ok).map(r => `⚠️ ${r.naam}: ${r.reden}`);
    const bodyTekst = [
      `Handmatig verwerkte transportopdracht(en) — ${easyAttachments.length} .easy-bestand(en)`,
      '',
      verwerkt.length ? verwerkt.join('\n') : '',
      mislukt.length ? '\n' + mislukt.join('\n') : '',
    ].filter(Boolean).join('\n');

    // Primair: AHQ Gmail-SMTP edge function (werkt betrouwbaar).
    // Fallback: oude OAuth Gmail-flow van nodeapibackend.
    try {
      await sendViaAhqEdge({
        to: naar,
        subject: `easytrip file - ${eersteRit || 'handmatige upload'}`,
        text: bodyTekst,
        attachments: alleBijlagen,
      });
      verzonden = true;
      viaKanaal = 'ahq-smtp';
    } catch (edgeErr) {
      try {
        await sendEmailWithAttachments({
          ritnummer: eersteRit || 'handmatige upload',
          to: naar,
          attachments: alleBijlagen,
          verwerkingsresultaten: resultaten.map(r => ({
            filename: r.easy || r.naam, parsed: r.ok, reden: r.reden,
          })),
        });
        verzonden = true;
        viaKanaal = 'nodeapi-oauth';
      } catch (oauthErr) {
        return res.status(500).json({
          ok: false,
          error: `Verwerken lukte maar email versturen mislukte. AHQ: ${edgeErr.message} | OAuth-fallback: ${oauthErr.message}`,
          resultaten,
        });
      }
    }
  }

  return res.json({
    ok: true,
    verzonden,
    via: viaKanaal,
    aantalEasy: easyAttachments.length,
    naar,
    resultaten,
    melding: verzonden
      ? `${easyAttachments.length} .easy-bestand(en) verstuurd naar ${naar}`
      : 'Geen enkele PDF kon verwerkt worden — geen email verstuurd',
  });
}
