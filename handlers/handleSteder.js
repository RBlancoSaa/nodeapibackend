// handlers/handleSteder.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseSteder from '../parsers/parseSteder.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';
import { checkDuplicaat, buildUpdateMelding } from '../utils/checkDuplicaat.js';

export default async function handleSteder({ buffer, base64, filename, mailSubject, fromEmail = '', getReleaseData = null }) {
  console.log(`📦 Verwerken van Steder-bestand: ${filename}`);

  const containers = await parseSteder(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Steder containers geparsed');
    return [];
  }

  if (getReleaseData) {
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  for (const container of containers) {
    try {
      // Ritnummer fallback: pak eerste getal uit emailonderwerp
      if (!container.ritnummer && mailSubject) {
        const m = (mailSubject || '').match(/\b(\d{7,})\b/);
        if (m) container.ritnummer = m[1];
      }

      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || container.laadreferentie || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_Steder.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      const vorigeEntry = await checkDuplicaat(cntr, 'Steder');
      const isUpdate    = !!vorigeEntry;
      if (isUpdate) console.log(`🔁 Steder update gedetecteerd: ${cntr}`);

      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: isUpdate ? `UPDATE easytrip file - ${ref}` : `easytrip file - ${ref}`,
        text: isUpdate
          ? `${buildUpdateMelding(vorigeEntry, cntr)}\nSteder transportopdracht verwerkt: ${ref}`
          : `Steder transportopdracht verwerkt: ${ref}`,
        attachments: [
          { filename: easyFilename, path: easyPath },
          { filename, content: Buffer.from(base64, 'base64') }
        ]
      });
      console.log(`📧 Steder verstuurd: ${easyFilename}${isUpdate ? ' (UPDATE)' : ''}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'Steder', afzenderEmail: fromEmail, bestandsnaam: filename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij Steder container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'Steder', afzenderEmail: fromEmail, bestandsnaam: filename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
