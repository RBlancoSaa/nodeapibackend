// handlers/handleEimskip.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseEimskip from '../parsers/parseEimskip.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';

export default async function handleEimskip({
  bodyText,
  mailSubject,
  mailFrom,
  fromEmail = '',
  pdfAttachments = []
}) {
  console.log(`📦 Eimskip verwerken: ${mailSubject}`);
  console.log(`📎 PDF-bijlagen: ${pdfAttachments.map(a => a.filename).join(', ') || 'geen'}`);

  const containers = await parseEimskip({ bodyText, mailSubject, pdfAttachments });

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Eimskip containers geparsed');
    return [];
  }

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || 'opdrachten@tiarotransport.nl';
  const easyBestanden = [];

  const fouten = [];

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      console.log('📄 Eimskip XML:\n' + xml);

      const cntr          = container.containernummer || 'onbekend';
      const ref           = container.ritnummer || cntr;
      const easyFilename  = `Order_${ref}_${cntr}_Eimskip.easy`;
      const easyPath      = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      // Verstuur .easy + originele PDFs als bijlagen
      const attachments = [{ filename: easyFilename, path: easyPath }];
      for (const att of pdfAttachments) {
        if (att.buffer) {
          attachments.push({ filename: att.filename, content: att.buffer });
        }
      }

      await transporter.sendMail({
        from, to,
        subject: `easytrip file - ${ref}`,
        text:    `Eimskip levering: ${cntr} — ${container.datum} ${container.tijd}`,
        attachments
      });

      console.log(`📧 Eimskip verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);

      await logOpdracht({
        bron:          'Eimskip',
        afzenderEmail: mailFrom || fromEmail,
        bestandsnaam:  mailSubject || '',
        container,
        easyBestand:   easyFilename
      });
    } catch (err) {
      console.error(`❌ Fout bij Eimskip container ${container.containernummer}:`, err.message);
      fouten.push(err.message);
      await logOpdracht({
        bron:          'Eimskip',
        afzenderEmail: mailFrom || fromEmail,
        bestandsnaam:  mailSubject || '',
        container,
        status:        'FOUT',
        foutmelding:   err.message
      });
    }
  }

  // Als alles mislukt is, gooi fout door zodat de response 'fout' toont i.p.v. 'overgeslagen'
  if (easyBestanden.length === 0 && fouten.length > 0) {
    throw new Error(fouten.join('; '));
  }

  return easyBestanden;
}
