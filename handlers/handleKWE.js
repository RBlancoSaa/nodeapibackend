// handlers/handleKWE.js
// KWE (Kintetsu World Express Benelux) import-orders — vrije e-mail-tekst, geen PDF.
// De extractie zit in parsers/parseKWE.js (geport + verbeterd uit AHQ kwe.ts).
// Deze handler orkestreert: parse → .easy genereren → mailen → loggen.
//
// preferBody: true in upload-from-inbox zorgt dat de body als bron komt en alle
// release-PDFs als bijlage meekomen (pdfAttachments).
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseKWE from '../parsers/parseKWE.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';

export default async function handleKWE({ bodyText = '', mailSubject = '', fromEmail = '', pdfAttachments = [] }) {
  console.log(`📦 KWE email verwerken: ${mailSubject}`);

  const containers = await parseKWE({ bodyText, mailSubject, pdfAttachments });
  if (!containers || containers.length === 0) {
    console.warn('⚠️ KWE: geen order geparsed');
    return [];
  }

  const body = (bodyText || '').replace(/\r\n/g, '\n');
  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  for (const container of containers) {
    try {
      const ref = container.ritnummer || 'KWE';
      const xml = await generateXmlFromJson(container);
      const easyFilename = `Order_${ref}_KWE.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      // Originele email body als bijlage
      const bodyFilename = `Email_${ref}_KWE.txt`;
      const bodyPath = path.join(os.tmpdir(), bodyFilename);
      fs.writeFileSync(bodyPath, Buffer.from(`Onderwerp: ${mailSubject}\nVan: ${fromEmail}\n\n${body}`, 'utf-8'));

      const bijlagen = [
        { filename: easyFilename, path: easyPath },
        { filename: bodyFilename, path: bodyPath },
      ];
      for (const pdf of (pdfAttachments || [])) {
        if (pdf?.buffer && Buffer.isBuffer(pdf.buffer)) {
          bijlagen.push({ filename: pdf.filename, content: pdf.buffer });
        }
      }

      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: `easytrip file - ${ref}`,
        text: [
          `KWE opdracht verwerkt: ${ref}`,
          container.datum     ? `Datum: ${container.datum}` : '',
          container.klantnaam ? `Klant: ${container.klantnaam}${container.klantplaats ? ', ' + container.klantplaats : ''}` : '',
          container.bootnaam  ? `Schip: ${container.bootnaam}` : '',
          container.instructies || '',
        ].filter(Boolean).join('\n'),
        attachments: bijlagen,
      });

      console.log(`📧 KWE verstuurd: ${easyFilename} (+ ${bijlagen.length - 1} bijlage(n))`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'KWE', afzenderEmail: fromEmail, bestandsnaam: mailSubject, container, easyBestand: easyFilename });
    } catch (err) {
      console.error('❌ Fout bij KWE opdracht:', err.message);
      await logOpdracht({ bron: 'KWE', afzenderEmail: fromEmail, bestandsnaam: mailSubject, container: container || {}, status: 'FOUT', foutmelding: err.message });
    }
  }

  return easyBestanden;
}
