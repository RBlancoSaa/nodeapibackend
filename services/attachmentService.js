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

      console.log(
        `📦 UID ${message.uid} - PDF attachments gevonden:`,
        attachments.map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.content?.length
        }))
      );

      mails.push({
        uid: message.uid,
        subject: message.envelope.subject || '(geen onderwerp)',
        from: message.envelope.from.map(f => `${f.name ?? ''} <${f.address}>`.trim()).join(', '),
        date: message.envelope.date,
        attachments: attachments.map(att => ({ filename: att.filename, contentType: att.contentType }))
      });

      for (const att of attachments) {
        const { error } = await supabase.storage
          .from('inboxpdf')
          .upload(att.filename, att.content, {
            contentType: att.contentType,
            cacheControl: '3600',
            upsert: true,
          });

        if (error) {
          console.error('Uploadfout:', error.message);
        } else {
          uploadedFiles.push({
            filename: att.filename,
            url: `${process.env.SUPABASE_URL}/storage/v1/object/public/inboxpdf/${att.filename}`
          });
        }
      }
    } catch (err) {
      console.error(`❌ Fout bij verwerken van UID ${message.uid}:`, err);
    }
  }

  return { mails, uploadedFiles };
}
