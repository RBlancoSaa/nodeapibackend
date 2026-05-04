// 📁 handlers/handleJordex.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';

export default async function handleJordex({ buffer, base64, filename, fromEmail = '', getReleaseData = null }) {
  console.log(`📦 Verwerken van Jordex-bestand: ${filename}`);

  const containers = await parseJordex(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Jordex containers geparsed');
    return;
  }

  if (getReleaseData) {
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || 'easybestanden@tiarotransport.nl';
  const easyBestanden = [];

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || container.laadreferentie || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_Jordex.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      await transporter.sendMail({
        from,
        to,
        subject: `easytrip file - ${ref}`,
        text: `Jordex transportopdracht verwerkt: ${ref}`,
        attachments: [
          { filename: easyFilename, path: easyPath },
          { filename, content: Buffer.from(base64, 'base64') }
        ]
      });
      console.log(`📧 Jordex verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'Jordex', afzenderEmail: fromEmail, bestandsnaam: filename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij Jordex container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'Jordex', afzenderEmail: fromEmail, bestandsnaam: filename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
