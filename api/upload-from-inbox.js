// .api/upload-from-inbox.js
import '../utils/fsPatch.js';
import { parseAttachmentsFromEmails } from '../services/parseAttachments.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { ImapFlow } from 'imapflow';

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
