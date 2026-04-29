// handlers/handleDFDS.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseDFDS from '../parsers/parseDFDS.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';

export default async function handleDFDS({ buffer, base64, filename }) {
  console.log(`📦 Verwerken van DFDS-bestand: ${filename}`);

  const result = await parseDFDS(buffer);
  const containers = result?.containers || [];

  if (containers.length === 0) {
    console.warn('⚠️ Geen DFDS containers geparsed');
    return [];
  }

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || 'opdrachten@tiarotransport.nl';
  const easyBestanden = [];

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_DFDS.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      await transporter.sendMail({
        from, to,
        subject: `easytrip file - ${ref}`,
        text: `DFDS transportopdracht verwerkt: ${ref}`,
        attachments: [
          { filename: easyFilename, path: easyPath },
          { filename, content: Buffer.from(base64, 'base64') }
        ]
      });
      console.log(`📧 DFDS verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
    } catch (err) {
      console.error(`❌ Fout bij DFDS container ${container.containernummer}:`, err.message);
    }
  }
  return easyBestanden;
}
