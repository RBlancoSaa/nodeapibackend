// handlers/handleNeelevat.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseRitra from '../parsers/parseRitra.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';

const NEELEVAT = {
  opdrachtgeverNaam:     'NEELE-VAT LOGISTICS B.V.',
  opdrachtgeverAdres:    'MOEZELWEG 100',
  opdrachtgeverPostcode: '3198 LS',
  opdrachtgeverPlaats:   'EUROPOORT-ROTTERDAM',
  opdrachtgeverTelefoon: '010-2888400',
  opdrachtgeverEmail:    'rotterdam@neele-vat.com',
  opdrachtgeverBTW:      '',
  opdrachtgeverKVK:      ''
};

export default async function handleNeelevat({ buffer, base64, filename, mailSubject }) {
  console.log(`📦 Verwerken van Neelevat-bestand: ${filename}`);

  // Neelevat gebruikt hetzelfde PDF-formaat als Ritra
  const containers = await parseRitra(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Neelevat containers geparsed');
    return [];
  }

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || from;
  const easyBestanden = [];

  for (const container of containers) {
    try {
      // Override opdrachtgever van Ritra naar Neelevat
      const neelevatContainer = { ...container, ...NEELEVAT };

      // Ritnummer uit emailonderwerp als parser niets vond (bijv. "SEF 354855")
      if (!neelevatContainer.ritnummer && mailSubject) {
        const m = (mailSubject || '').match(/SEF\s*(\d{5,})/i);
        if (m) neelevatContainer.ritnummer = m[1];
      }

      const xml = await generateXmlFromJson(neelevatContainer);
      const cntr = neelevatContainer.containernummer || 'onbekend';
      const ref  = neelevatContainer.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_Neelevat.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      await transporter.sendMail({
        from, to,
        subject: `easytrip file - ${ref}`,
        text: `Neelevat transportopdracht verwerkt: ${ref}`,
        attachments: [
          { filename: easyFilename, path: easyPath },
          { filename, content: Buffer.from(base64, 'base64') }
        ]
      });
      console.log(`📧 Neelevat verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
    } catch (err) {
      console.error(`❌ Fout bij Neelevat container ${container.containernummer}:`, err.message);
    }
  }
  return easyBestanden;
}
