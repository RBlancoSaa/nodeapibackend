// handlers/handleB2L.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseB2L from '../parsers/parseB2L.js';
import { isReleasePdf, parseRelease } from '../parsers/parseRelease.js';
import pdfParse from 'pdf-parse';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL, metOrigineel } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';
import { checkDuplicaat, buildUpdateMelding } from '../utils/checkDuplicaat.js';

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
  bodyText = '',
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
        // Sla release op onder elk containernummer dat erin staat (CMA CGM heeft meerdere)
        const nummers = rd.containernummers?.length ? rd.containernummers : (rd.containernummer ? [rd.containernummer] : []);
        if (nummers.length) {
          for (const cntr of nummers) lokaalReleaseMap[cntr] = rd;
        } else {
          lokaalReleaseMap['_any'] = rd;
        }
        console.log(`📋 B2L release gevonden in bijlage "${pdf.filename}": containers=[${nummers.join(', ')}] ref="${rd.referentie}" afzetRef="${rd.inleverreferentie}" emptyReturn="${rd.emptyReturnNaam}"`);
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

      // Bijlagen: .easy + TO PDF + alle overige bijlagen (releases, IMA, etc.)
      const attachments = [
        { filename: easyFilename, path: easyPath },
        ...(toBase64 ? [{ filename: toFilename, content: Buffer.from(toBase64, 'base64') }] : []),
        ...bijlagePdfs
          .filter(p => p.buffer)
          .map(p => ({
            filename: p.filename,
            content: p.buffer
          }))
      ];

      const vorigeEntry = await checkDuplicaat(cntr, 'B2L');
      const isUpdate    = !!vorigeEntry;
      if (isUpdate) console.log(`🔁 B2L update gedetecteerd: ${cntr}`);

      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: isUpdate ? `UPDATE easytrip file - ${ref}` : `easytrip file - ${ref}`,
        text: metOrigineel(
          isUpdate
            ? `${buildUpdateMelding(vorigeEntry, cntr)}\nB2L transportopdracht verwerkt: ${ref}`
            : `B2L transportopdracht verwerkt: ${ref}`,
          bodyText),
        attachments
      });
      console.log(`📧 B2L verstuurd: ${easyFilename}${isUpdate ? ' (UPDATE)' : ''}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'B2L', afzenderEmail: fromEmail, bestandsnaam: toFilename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij B2L container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'B2L', afzenderEmail: fromEmail, bestandsnaam: toFilename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
