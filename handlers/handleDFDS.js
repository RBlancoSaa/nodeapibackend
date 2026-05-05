// handlers/handleDFDS.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseDFDS from '../parsers/parseDFDS.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';

/**
 * Sorteert een lijst PDFs zodat de echte DFDS-transportorder als eerste geprobeerd wordt.
 * DG-formulieren (IMO/ADR), facturen en booking confirmations zijn bijlagen, geen orders.
 */
function sorteerDFDSPdfs(pdfs) {
  const score = fn => {
    const f = (fn || '').toLowerCase();
    // Echte transportorder = "Logistiek - Transportorder" of "transportorder"
    if (/logistiek.*transport|transport.*order/i.test(f)) return 0;
    // Magazijn-opdracht (S-nummer formaat, PICKUP/LOAD/UNLOAD structuur)
    if (/magazijn.*zending|proforma.*zending/i.test(f)) return 1;
    // Booking confirmation
    if (/booking.*confirm|confirm.*booking/i.test(f)) return 2;
    // DG-formulieren / IMO: bestandsnaam begint vaak met containernummer (EGSU/EMCU/EITU...)
    // of bevat "DG" of heeft een boeking-codenummer als naam (bijv. "DB51G22T1.PDF")
    if (/\bDG\b/i.test(f)) return 10;
    if (/^[A-Z]{4}\d{7}|^[A-Z]{2}\d+[A-Z]\d+\.pdf$/i.test(fn)) return 10;
    return 5; // overige bijlagen
  };
  return [...pdfs].sort((a, b) => score(a.filename) - score(b.filename));
}

export default async function handleDFDS({ buffer, base64, filename, fromEmail = '', getReleaseData = null, allPdfs = null }) {
  console.log(`📦 Verwerken van DFDS-bestand: ${filename}`);

  // Lege buffer = geen echte PDF (bijv. afkoppelen/planning email, inline bijlage)
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    console.log(`⏭️ DFDS: geen PDF-buffer voor "${filename || '(geen bestand)'}" — overgeslagen`);
    return [];
  }

  // Als er meerdere PDFs zijn (allPdfs), probeer ze in volgorde totdat één containers geeft.
  // De echte transportorder (Logistiek - Transportorder) wordt geprioriteerd boven DG-formulieren.
  const kandidaten = allPdfs && allPdfs.length > 0
    ? sorteerDFDSPdfs(allPdfs)
    : [{ buffer, base64, filename }];

  let containers = [];
  let gebruiktePdf = { buffer, base64, filename };

  for (const pdf of kandidaten) {
    if (!pdf.buffer || !Buffer.isBuffer(pdf.buffer) || pdf.buffer.length === 0) {
      console.log(`⏭️ DFDS: lege buffer voor "${pdf.filename}" — overgeslagen`);
      continue;
    }
    console.log(`🔍 DFDS: probeer PDF "${pdf.filename}"`);
    try {
      const result = await parseDFDS(pdf.buffer);
      const gevonden = Array.isArray(result) ? result : (result?.containers || []);
      if (gevonden.length > 0) {
        containers = gevonden;
        gebruiktePdf = pdf;
        console.log(`✅ DFDS: ${gevonden.length} container(s) gevonden in "${pdf.filename}"`);
        break;
      } else {
        console.log(`⏭️ DFDS: geen containers in "${pdf.filename}", probeer volgende`);
      }
    } catch (err) {
      console.warn(`⚠️ DFDS: fout bij parsen "${pdf.filename}": ${err.message} — probeer volgende`);
    }
  }

  if (containers.length === 0) {
    console.warn('⚠️ Geen DFDS containers geparsed (alle PDFs geprobeerd)');
    return [];
  }

  if (getReleaseData) {
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  // Originele PDF bijlage: de daadwerkelijk gebruikte transportorder
  const origFilename = gebruiktePdf.filename || filename;
  const origBase64   = gebruiktePdf.base64   || base64;

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_DFDS.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: `easytrip file - ${ref}`,
        text: `DFDS transportopdracht verwerkt: ${ref}`,
        attachments: [
          { filename: easyFilename, path: easyPath },
          { filename: origFilename, content: Buffer.from(origBase64, 'base64') }
        ]
      });
      console.log(`📧 DFDS verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'DFDS', afzenderEmail: fromEmail, bestandsnaam: origFilename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij DFDS container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'DFDS', afzenderEmail: fromEmail, bestandsnaam: origFilename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
