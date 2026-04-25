// handlers/handleRitra.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseRitra from '../parsers/parseRitra.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, hasGmail } from '../utils/gmailTransport.js';

export default async function handleRitra({ buffer, base64, filename }) {
  console.log(`📦 Verwerken van Ritra-bestand: ${filename}`);

  const containers = await parseRitra(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Ritra containers geparsed');
    return;
  }

  const { transporter, from } = getGmailTransporter();
  const ordernummer = containers[0]?.ritnummer || `ritra_${Date.now()}`;

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_Ritra.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      const attachments = [
        { filename: easyFilename, path: easyPath },
        { filename, content: Buffer.from(base64, 'base64') }
      ];

      const to = process.env.RECIPIENT_EMAIL || from;
      await transporter.sendMail({
        from, to,
        subject: `easytrip file - ${ref}`,
        text: `Ritra transportopdracht verwerkt: ${ref}`,
        attachments
      });
      console.log(`📧 Ritra verstuurd: ${easyFilename}`);
    } catch (err) {
      console.error(`❌ Fout bij Ritra container ${container.containernummer}:`, err.message);
    }
  }
}
