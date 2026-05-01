// handlers/handleNeelevat.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseNeelevat from '../parsers/parseNeelevat.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';

export default async function handleNeelevat({ buffer, base64, filename, mailSubject, fromEmail = '', getReleaseData = null }) {
  console.log(`📦 Verwerken van Neelevat-bestand: ${filename}`);

  const containers = await parseNeelevat(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Neelevat containers geparsed');
    return [];
  }

  if (getReleaseData) {
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || 'opdrachten@tiarotransport.nl';
  const easyBestanden = [];

  for (const container of containers) {
    try {
      // Ritnummer fallback: pak eerste lange getal uit emailonderwerp
      if (!container.ritnummer && mailSubject) {
        const m = (mailSubject || '').match(/\b(\d{7,})\b/);
        if (m) container.ritnummer = m[1];
      }

      const xml = await generateXmlFromJson(container);
      console.log('📄 Neelevat XML volledig:\n' + xml);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
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
      await logOpdracht({ bron: 'Neelevat', afzenderEmail: fromEmail, bestandsnaam: filename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij Neelevat container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'Neelevat', afzenderEmail: fromEmail, bestandsnaam: filename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
