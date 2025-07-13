// .api/upload-from-inbox.js
import '../utils/fsPatch.js';
import { parseAttachmentsFromEmails } from '../services/parseAttachments.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { ImapFlow } from 'imapflow';
import parseDFDS from '../parsers/parseDFDS.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js'; // voeg toe aan top

function isDfdsTransportOrder(filename) {
  const name = filename.toLowerCase();
  return name.includes('transportorder') && name.includes('dfds');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let client;
  try {
    client = new ImapFlow({
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT),
      secure: process.env.IMAP_SECURE === 'true',
      auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS
      }
    });

    await client.connect();
    await client.mailboxOpen('INBOX');

    const uids = await client.search({ seen: false });
    if (uids.length === 0) {
      await client.logout();
      return res.status(200).json({ message: 'Geen ongelezen mails' });
    }

    const { mails, allAttachments } = await parseAttachmentsFromEmails(client, uids);

    const pdfAttachments = allAttachments.filter(att =>
      att.filename && att.filename.toLowerCase().endsWith('.pdf')
    );
    console.log('🧾 PDF-bijlagen gevonden:', pdfAttachments.length);
    pdfAttachments.forEach(att => {
    console.log(` - 📎 ${att.filename} (${att.base64 ? 'base64 aanwezig' : 'GEEN base64'})`);
});
    const uploadedFiles = await uploadPdfAttachmentsToSupabase(pdfAttachments);
  // Na upload van PDF's, verwerk ze tot .easy-bestanden
    for (const mail of mails) {
      if (mail.source === 'Jordex' && mail.parsedData && mail.xmlBase64) {
        try {
          const response = await fetch(`${process.env.BASE_URL}/api/generate-easy-files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reference: mail.parsedData.referentie,  // ✅ FIX: rename veld
              laadplaats: mail.parsedData.laadplaats || '0',
              pdfBestandsnaam: mail.originalPdfFilename || 'origineel.pdf',
              skipReprocessing: false,
                originalPdfBase64: mail.originalPdfBase64,
              ...mail.parsedData
            })
          });

          const result = await response.json();
          console.log('📤 generate-easy-files resultaat:', result);
        } catch (err) {
          console.warn('⚠️ Fout bij genereren van .easy:', err.message);
        }
      } else {
        console.log('⏭️ Geen geldige parserdata of niet Jordex');
      }
    }

for (const attachment of pdfAttachments) {

  const { filename, buffer, base64 } = attachment;

  if (!filename) continue;
  console.log(`🧪 Controleren op DFDS: ${filename}`);
  if (isDfdsTransportOrder(filename)) {
  console.log(`✅ DFDS transportorder herkend: ${filename}`);
} else {
  console.log(`⛔ Niet herkend als DFDS transportorder: ${filename}`);
}
  if (isDfdsTransportOrder(filename)) {
    console.log(`📄 DFDS transportopdracht gedetecteerd: ${filename}`);
    const parsedData = await parseDFDS(buffer);

    const easyFiles = [];

    for (const container of parsedData.containers) {
      try {
        const response = await fetch(`${process.env.BASE_URL}/api/generate-easy-files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reference: parsedData.ritnummer || '0',
            laadplaats: container.laadplaats || '0',
            pdfBestandsnaam: filename,
            skipReprocessing: false,
            originalPdfBase64: base64,
            ...container
          })
        });

        const result = await response.json();
        console.log('📤 .easy gegenereerd voor DFDS-container:', result);

        easyFiles.push({
          filename: result.bestandsnaam,
          xmlBase64: result.xmlBase64
        });

      } catch (err) {
        console.warn('⚠️ Fout bij DFDS .easy-generatie:', err.message);
      }
    }

    // 📬 Verstuur .easy-bestanden + originele PDF
    try {
      await sendEmailWithAttachments({
        ritnummer: parsedData.ritnummer,
        attachments: [
          ...easyFiles.map(file => ({
            filename: file.filename,
            content: Buffer.from(file.xmlBase64, 'base64')
          })),
          {
            filename,
            content: Buffer.from(base64, 'base64')
          }
        ]
      });

      console.log(`✅ Mail verstuurd voor rit ${parsedData.ritnummer}`);
    } catch (err) {
      console.error('📧 Fout bij e-mailverzending DFDS:', err.message);
    }
  } else {
    console.log(`⏭️ Bijlage is geen DFDS transportorder: ${filename}`);
  }
}

await client.logout();

return res.status(200).json({
  success: true,
  mailCount: mails.length,
  attachmentCount: allAttachments.length,
  uploadedCount: uploadedFiles.length,
  filenames: uploadedFiles.map(f => f.filename)
});

  } catch (error) {
    if (client) await client.logout().catch(() => {});
    console.error('💥 Upload-fout:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Onbekende serverfout tijdens upload'
    });
  }
}
