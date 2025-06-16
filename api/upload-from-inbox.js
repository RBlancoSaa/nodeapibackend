// 📁 automatinglogistics-api/pages/api/upload-from-inbox.js

import { parseAttachmentsFromEmails } from '../services/parseAttachments.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { ImapFlow } from 'imapflow';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ✅ 1. Verbind met IMAP
    const client = new ImapFlow({
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

    const uids = await client.search({ seen: false });
    if (uids.length === 0) {
      await client.logout();
      return res.status(200).json({ message: 'Geen ongelezen mails' });
    }

    // ✅ 2. Parse bijlagen uit e-mails
    const { mails, allAttachments } = await parseAttachmentsFromEmails(client, uids);

    // ✅ 3. Debug logging
    console.log('📥 Totaal bijlagen:', allAttachments.length);
    console.log('🪣 SUPABASE_BUCKET:', process.env.SUPABASE_BUCKET);
    console.log('🔑 SUPABASE_API_KEY:', process.env.SUPABASE_API_KEY?.slice(0, 10) + '...');

    // ✅ 4. Upload alle PDF-bijlagen
    const uploadedFiles = await uploadPdfAttachmentsToSupabase(allAttachments);

    await client.logout();

    return res.status(200).json({
      success: true,
      mails,
      uploadedFiles,
    });
  } catch (error) {
    console.error('💥 Upload-fout:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Onbekende serverfout tijdens upload',
    });
  }
}
