// handlers/handleSteder.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseSteder from '../parsers/parseSteder.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';

export default async function handleSteder({ buffer, base64, filename, mailSubject }) {
  console.log(`📦 Verwerken van Steder-bestand: ${filename}`);

  const containers = await parseSteder(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Steder containers geparsed');
    return [];
  }

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || 'opdrachten@tiarotransport.nl';
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

      await transporter.sendMail({
        from, to,
        subject: `easytrip file - ${ref}`,
        text: `Steder transportopdracht verwerkt: ${ref}`,
        attachments: [
          { filename: easyFilename, path: easyPath },
          { filename, content: Buffer.from(base64, 'base64') }
        ]
      });
      console.log(`📧 Steder verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
    } catch (err) {
      console.error(`❌ Fout bij Steder container ${container.containernummer}:`, err.message);
    }
  }
  return easyBestanden;
}
