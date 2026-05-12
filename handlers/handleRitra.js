// handlers/handleRitra.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseRitra from '../parsers/parseRitra.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, hasGmail, RECIPIENT_EMAIL, metOrigineel } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';
import { checkDuplicaat, buildUpdateMelding, voegUpdateInstructieToe } from '../utils/checkDuplicaat.js';

export default async function handleRitra({ buffer, base64, filename, mailSubject = '', fromEmail = '', bodyText = '', getReleaseData = null }) {
  console.log(`📦 Verwerken van Ritra-bestand: ${filename}`);

  const containers = await parseRitra(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Ritra containers geparsed');
    return;
  }

  if (getReleaseData) {
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  for (const container of containers) {
    try {
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;

      // Update-detectie vóór XML-generatie zodat waarschuwing in .easy terecht komt
      const vorigeEntry = await checkDuplicaat(cntr, 'Ritra');
      const isUpdate    = !!vorigeEntry;
      const updateTekst = isUpdate ? buildUpdateMelding(vorigeEntry, cntr) : '';
      if (isUpdate) console.log(`🔁 Ritra update gedetecteerd: ${cntr} (vorige: ${vorigeEntry.datum} ${vorigeEntry.tijd})`);
      voegUpdateInstructieToe(container, vorigeEntry, mailSubject);

      const xml = await generateXmlFromJson(container);
      const easyFilename = `Order_${ref}_${cntr}_Ritra.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      const emailBody = metOrigineel(
        isUpdate
          ? `${updateTekst}\nRitra transportopdracht verwerkt: ${ref}`
          : `Ritra transportopdracht verwerkt: ${ref}`,
        bodyText);

      const emailSubject = isUpdate
        ? `UPDATE easytrip file - ${ref}`
        : `easytrip file - ${ref}`;

      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: emailSubject,
        text: emailBody,
        attachments: [
          { filename: easyFilename, path: easyPath },
          { filename, content: Buffer.from(base64, 'base64') }
        ]
      });
      console.log(`📧 Ritra verstuurd: ${easyFilename}${isUpdate ? ' (UPDATE)' : ''}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'Ritra', afzenderEmail: fromEmail, bestandsnaam: filename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij Ritra container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'Ritra', afzenderEmail: fromEmail, bestandsnaam: filename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
