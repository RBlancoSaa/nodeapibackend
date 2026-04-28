// 📁 handlers/handleJordex.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';

export default async function handleJordex({ buffer, base64, filename }) {
  console.log(`📦 Verwerken van Jordex-bestand: ${filename}`);

  const containers = await parseJordex(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Jordex containers geparsed');
    return;
  }

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || from;
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
    } catch (err) {
      console.error(`❌ Fout bij Jordex container ${container.containernummer}:`, err.message);
    }
  }
  return easyBestanden;
}
