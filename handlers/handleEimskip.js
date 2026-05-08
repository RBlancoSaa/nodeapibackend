// handlers/handleEimskip.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseEimskip from '../parsers/parseEimskip.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';
import { checkDuplicaat, buildUpdateMelding } from '../utils/checkDuplicaat.js';

export default async function handleEimskip({
  bodyText,
  mailSubject,
  mailFrom,
  fromEmail = '',
  pdfAttachments = [],
  getReleaseData = null
}) {
  console.log(`📦 Eimskip verwerken: ${mailSubject}`);
  console.log(`📎 PDF-bijlagen: ${pdfAttachments.map(a => a.filename).join(', ') || 'geen'}`);

  const containers = await parseEimskip({ bodyText, mailSubject, pdfAttachments });

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Eimskip containers geparsed');
    return [];
  }

  // Validatie: filter containers zonder zinvolle transportdata weg.
  // Reply-threads (bijv. "RE: Fysieke controle container XXXX") leveren wel een
  // containernummer op maar hebben geen klantnaam, ritnummer of laad/loslocatie.
  const geldige = containers.filter(c => {
    const heeftKlant      = !!(c.klantnaam && c.klantnaam.trim());
    const heeftRitnr      = !!(c.ritnummer && c.ritnummer.trim());
    const heeftLosLocatie = (c.locaties || []).some(l =>
      /lossen|laden/i.test(l.actie || '') && !!(l.naam || l.adres || l.postcode)
    );
    return heeftKlant || heeftRitnr || heeftLosLocatie;
  });

  if (geldige.length === 0) {
    console.warn('⚠️ Eimskip: geen geldige transportdata gevonden (mogelijk reply-thread of doorstuur-mail) — overgeslagen');
    return [];
  }

  if (getReleaseData) {
    for (const c of geldige) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  const fouten = [];

  for (const container of geldige) {
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

      const vorigeEntry = await checkDuplicaat(cntr, 'Eimskip');
      const isUpdate    = !!vorigeEntry;
      if (isUpdate) console.log(`🔁 Eimskip update gedetecteerd: ${cntr}`);

      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: isUpdate ? `UPDATE easytrip file - ${ref}` : `easytrip file - ${ref}`,
        text:    isUpdate
          ? `${buildUpdateMelding(vorigeEntry, cntr)}\nEimskip levering: ${cntr} — ${container.datum} ${container.tijd}`
          : `Eimskip levering: ${cntr} — ${container.datum} ${container.tijd}`,
        attachments
      });

      console.log(`📧 Eimskip verstuurd: ${easyFilename}${isUpdate ? ' (UPDATE)' : ''}`);
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
