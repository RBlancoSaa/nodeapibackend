// 📁 handlers/handleJordex.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL, metOrigineel } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';
import { checkDuplicaat, buildUpdateMelding } from '../utils/checkDuplicaat.js';

export default async function handleJordex({ buffer, base64, filename, mailSubject = '', bodyText = '', fromEmail = '', getReleaseData = null }) {
  console.log(`📦 Verwerken van Jordex-bestand: ${filename}`);

  // Cancelled orders overslaan — geen .easy aanmaken voor gecancelde opdrachten
  if (/cancelled/i.test(filename || '')) {
    console.log(`⏭️ Jordex cancelled order overgeslagen: ${filename}`);
    return [];
  }

  // Update-detectie via email-onderwerp keywords (vroeg signaal, nog vóór parse)
  const subjectIsUpdate = /\b(update[d]?|correction[s]?|corrected|amendment|reschedule[d]?|revised|wijziging)\b/i.test(mailSubject || '') ||
                          /\b(update[d]?|correction[s]?|corrected)\b/i.test(filename || '');
  if (subjectIsUpdate) {
    console.log(`🔄 Jordex UPDATE via onderwerp: ${mailSubject || filename}`);
  }

  // Bepaal input: PDF buffer heeft voorkeur, anders email body als fallback
  const heeftPdf = buffer && Buffer.isBuffer(buffer) && buffer.length > 100;
  const input    = heeftPdf ? buffer : (bodyText || '');

  if (!heeftPdf) {
    if (bodyText) {
      console.log('📋 Jordex: geen PDF — verwerk via email body tekst');
    } else {
      console.warn('⚠️ Jordex: geen PDF buffer en geen bodyText beschikbaar');
      return [];
    }
  }

  const containers = await parseJordex(input);

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Jordex containers geparsed');
    return;
  }

  if (getReleaseData) {
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || container.laadreferentie || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_Jordex.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      // Update-detectie: DB-check op containernummer (betrouwbaarder dan keyword)
      const vorigeEntry = await checkDuplicaat(cntr, 'Jordex');
      const isUpdate    = !!vorigeEntry || subjectIsUpdate;
      if (isUpdate) console.log(`🔁 Jordex update gedetecteerd: ${cntr}`);

      const emailBody = metOrigineel(
        isUpdate
          ? `${vorigeEntry ? buildUpdateMelding(vorigeEntry, cntr) : 'LET OP: updated transportation request\n\n'}Jordex transportopdracht verwerkt: ${ref}`
          : `Jordex transportopdracht verwerkt: ${ref}`,
        bodyText);

      const bijlagen = [{ filename: easyFilename, path: easyPath }];
      if (heeftPdf && base64 && filename) {
        bijlagen.push({ filename, content: Buffer.from(base64, 'base64') });
      }

      await transporter.sendMail({
        from,
        to: RECIPIENT_EMAIL,
        subject: isUpdate ? `UPDATE easytrip file - ${ref}` : `easytrip file - ${ref}`,
        text: emailBody,
        attachments: bijlagen
      });
      console.log(`📧 Jordex verstuurd: ${easyFilename}${isUpdate ? ' (UPDATE)' : ''}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'Jordex', afzenderEmail: fromEmail, bestandsnaam: filename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij Jordex container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'Jordex', afzenderEmail: fromEmail, bestandsnaam: filename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
