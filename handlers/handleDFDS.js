// handlers/handleDFDS.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseDFDS from '../parsers/parseDFDS.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';

export default async function handleDFDS({ buffer, base64, filename, fromEmail = '', getReleaseData = null }) {
  console.log(`📦 Verwerken van DFDS-bestand: ${filename}`);

  const result = await parseDFDS(buffer);
  const containers = Array.isArray(result) ? result : (result?.containers || []);

  if (containers.length === 0) {
    console.warn('⚠️ Geen DFDS containers geparsed');
    return [];
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
      await logOpdracht({ bron: 'DFDS', afzenderEmail: fromEmail, bestandsnaam: filename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij DFDS container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'DFDS', afzenderEmail: fromEmail, bestandsnaam: filename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
