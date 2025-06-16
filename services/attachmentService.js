// 📁 automatinglogistics-api/services/attachmentService.js

import { simpleParser } from 'mailparser';

export async function findAttachmentsAndUpload(client, uids, supabase) {
  const mails = [];
  const uploadedFiles = [];

  for await (const message of client.fetch(uids, { envelope: true, source: true })) {
    try {
      const parsed = await simpleParser(message.source);
      const attachments = (parsed.attachments || []).filter(att =>
        att.filename && att.filename.toLowerCase().endsWith('.pdf')
      );

      console.log(`📨 UID ${message.uid} - PDF attachments gevonden:`);
      attachments.forEach(a => {
        console.log(`   - ${a.filename} (${a.content?.length} bytes, ${a.contentType})`);
      });

      mails.push({
        uid: message.uid,
        subject: message.envelope.subject || '(geen onderwerp)',
        from: message.envelope.from.map(f => `${f.name ?? ''} <${f.address}>`.trim()).join(', '),
        date: message.envelope.date,
        attachments: attachments.map(att => ({ filename: att.filename, contentType: att.contentType }))
      });

      for (const att of attachments) {
        try {
          console.log(`➡️ Uploaden: ${att.filename} (${att.content?.length} bytes)`);

          const contentBuffer = Buffer.isBuffer(att.content)
            ? att.content
            : Buffer.from(att.content, att.transferEncoding || 'base64');

          const { error } = await supabase.storage
            .from('inboxpdf')
            .upload(att.filename, contentBuffer, {
              contentType: att.contentType || 'application/pdf',
              cacheControl: '3600',
              upsert: true,
            });

          if (error) {
            console.error(`❌ Uploadfout bij ${att.filename}:`, error.message);
          } else {
            console.log(`✅ Succesvol geüpload: ${att.filename}`);
            uploadedFiles.push({
              filename: att.filename,
              url: `${process.env.SUPABASE_URL}/storage/v1/object/public/inboxpdf/${att.filename}`
            });
          }
        } catch (uploadErr) {
          console.error(`❌ Upload exception bij ${att.filename}:`, uploadErr);
        }
      }
    } catch (err) {
      console.error(`❌ Parserfout bij UID ${message.uid}:`, err);
    }
  }

  return { mails, uploadedFiles };
}
