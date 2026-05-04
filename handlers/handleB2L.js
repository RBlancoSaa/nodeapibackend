// handlers/handleB2L.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseB2L from '../parsers/parseB2L.js';
import { isReleasePdf, parseRelease } from '../parsers/parseRelease.js';
import pdfParse from 'pdf-parse';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';

// Controleert of een parse-resultaat een echte transportopdracht is
// (niet een release of wegvervoer die per ongeluk iets parsete)
function isGeldigeTO(containers) {
  if (!containers?.length) return false;
  return containers.some(c =>
    (c.klantnaam  && c.klantnaam.length  > 2) ||
    (c.klantplaats && c.klantplaats.length > 1) ||
    (c.locaties?.some(l => l.naam))
  );
}

export default async function handleB2L({
  buffer, base64, filename, fromEmail = '',
  allPdfs = null,       // alle PDFs uit dezelfde email
  getReleaseData = null
}) {
  // Als er meerdere PDFs zijn: probeer elke PDF als TO, gebruik de rest als release/bijlage
  const pdfLijst = allPdfs || [{ buffer, base64, filename }];
  console.log(`📦 B2L: ${pdfLijst.length} PDF(s) ontvangen: ${pdfLijst.map(p => p.filename).join(', ')}`);

  // ── Identificeer welke PDF de TO is en welke bijlages zijn ──────────────
  let containers = [];
  let toPdf = null;
  const bijlagePdfs = [];

  for (const pdf of pdfLijst) {
    if (!pdf.buffer) continue;
    try {
      const result = await parseB2L(pdf.buffer);
      if (isGeldigeTO(result)) {
        // Eerste geldige TO wint
        if (!toPdf) {
          containers = result;
          toPdf = pdf;
          console.log(`✅ B2L TO herkend: ${pdf.filename}`);
        } else {
          // Tweede geldige TO (meerdere containers per email — zeldzaam)
          containers.push(...result);
          console.log(`✅ B2L extra TO: ${pdf.filename}`);
        }
      } else {
        bijlagePdfs.push(pdf);
        console.log(`📎 B2L bijlage (geen TO): ${pdf.filename}`);
      }
    } catch (err) {
      bijlagePdfs.push(pdf);
      console.warn(`⚠️ parseB2L mislukt voor ${pdf.filename}: ${err.message}`);
    }
  }

  if (containers.length === 0) {
    console.warn('⚠️ Geen geldige B2L transportopdracht gevonden in de bijlagen');
    return [];
  }

  // ── Extraheer release-data uit bijlages die geen TO zijn ────────────────
  const lokaalReleaseMap = {};
  for (const pdf of bijlagePdfs) {
    try {
      const { text } = await pdfParse(pdf.buffer);
      if (isReleasePdf(text)) {
        const rd = await parseRelease(pdf.buffer);
        const key = rd.containernummer || '_any';
        lokaalReleaseMap[key] = rd;
        console.log(`📋 B2L release gevonden in bijlage "${pdf.filename}": ref="${rd.referentie}" afzetRef="${rd.inleverreferentie}"`);
      } else {
        console.log(`📄 B2L bijlage "${pdf.filename}" overgeslagen (geen release, geen TO)`);
      }
    } catch (err) {
      console.warn(`⚠️ Bijlage check mislukt voor ${pdf.filename}:`, err.message);
    }
  }

  // ── Verrijk containers met release-data ─────────────────────────────────
  for (const c of containers) {
    // Eerst lokale release (uit bijlage in zelfde email)
    const lokaal = lokaalReleaseMap[c.containernummer?.toUpperCase()] || lokaalReleaseMap['_any'];
    if (lokaal) mergeRelease(c, lokaal);
    // Dan externe release (doorgegeven vanuit upload-from-inbox)
    if (getReleaseData) mergeRelease(c, getReleaseData(c.containernummer));
  }

  // ── Genereer .easy bestanden ─────────────────────────────────────────────
  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || 'easybestanden@tiarotransport.nl';
  const easyBestanden = [];
  const toFilename = toPdf?.filename || filename;
  const toBase64   = toPdf?.base64   || base64;

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_B2L.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      await transporter.sendMail({
        from, to,
        subject: `easytrip file - ${ref}`,
        text: `B2L transportopdracht verwerkt: ${ref}`,
        attachments: [
          { filename: easyFilename, path: easyPath },
          ...(toBase64 ? [{ filename: toFilename, content: Buffer.from(toBase64, 'base64') }] : [])
        ]
      });
      console.log(`📧 B2L verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'B2L', afzenderEmail: fromEmail, bestandsnaam: toFilename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij B2L container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'B2L', afzenderEmail: fromEmail, bestandsnaam: toFilename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
