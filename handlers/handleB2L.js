// handlers/handleB2L.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseB2L from '../parsers/parseB2L.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, hasGmail } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';

export default async function handleB2L({ buffer, base64, filename, fromEmail = '', getReleaseData = null }) {
  console.log(`📦 Verwerken van B2L-bestand: ${filename}`);

  const containers = await parseB2L(buffer);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen B2L containers geparsed');
    return;
  }

  if (getReleaseData) {
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || 'opdrachten@tiarotransport.nl';
  const easyBestanden = [];

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_B2L.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      await transporter.sendMail({
        from, to,
        subject: `easytrip file - ${ref}`,
        text: `B2L transportopdracht verwerkt: ${ref}`,
        attachments: [
          { filename: easyFilename, path: easyPath },
          { filename, content: Buffer.from(base64, 'base64') }
        ]
      });
      console.log(`📧 B2L verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'B2L', afzenderEmail: fromEmail, bestandsnaam: filename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij B2L container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'B2L', afzenderEmail: fromEmail, bestandsnaam: filename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
