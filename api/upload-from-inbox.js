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
        pass: process.env.IMAP_PASS,
      },
    });

    await client.connect();
    await client.mailboxOpen('INBOX');

    let uids = await client.search({ seen: false });
    if (uids.length === 0) {
      await client.logout();
      return res.status(200).json({ message: 'Geen ongelezen mails' });
    }

    // Beperk het aantal te verwerken e-mails
    uids = uids.slice(-10);

    const { mails, allAttachments } = await parseAttachmentsFromEmails(client, uids);

    // Filter alleen PDF's
    const pdfAttachments = allAttachments.filter(att =>
      att.filename && att.filename.toLowerCase().endsWith('.pdf')
    );

    const uploadedFiles = await uploadPdfAttachmentsToSupabase(pdfAttachments);

    await client.logout();

    return res.status(200).json({
      success: true,
      mailCount: mails.length,
      attachmentCount: allAttachments.length,
      uploadedCount: uploadedFiles.length,
      filenames: uploadedFiles.map(f => f.filename),
    });
  } catch (error) {
    if (client) await client.logout().catch(() => {});
    console.error('💥 Upload-fout:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Onbekende serverfout tijdens upload',
    });
  }
}