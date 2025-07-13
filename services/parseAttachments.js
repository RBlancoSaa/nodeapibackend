// 📁 automatinglogistics-api/services/parseAttachments.js

import { simpleParser } from 'mailparser';

export async function parseAttachmentsFromEmails(client, uids) {
  const mails = [];
  const allAttachments = [];

  for await (const message of client.fetch(uids, { envelope: true, source: true })) {
    try {
      const parsed = await simpleParser(message.source);
      const attachments = parsed.attachments || [];

      // 📛 Skip testbestand 05-versions-space.pdf
if (attachments.some(a => a.filename === '05-versions-space.pdf')) {
  console.warn(`⛔ Testbestand 05-versions-space.pdf genegeerd voor UID ${message.uid}`);
  continue; // sla deze e-mail volledig over
}

      console.log(
        `📦 UID ${message.uid} - attachments gevonden:`,
        attachments.map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.content?.length
        }))
      );

const pdfAttachment = attachments.find(att => att.filename?.toLowerCase().endsWith('.pdf'));
const pdfBase64 = pdfAttachment?.content?.toString('base64') || null;

mails.push({
  uid: message.uid,
  subject: message.envelope.subject || '(geen onderwerp)',
  from: message.envelope.from.map(f => `${f.name ?? ''} <${f.address}>`.trim()).join(', '),
  date: message.envelope.date,
  originalPdfFilename: pdfAttachment?.filename || null,   // ✅ toegevoegd
  originalPdfBase64: pdfBase64,                           // ✅ toegevoegd
  attachments: attachments.map(att => ({
    filename: att.filename,
    contentType: att.contentType,
    content: att.content
  }))
});


      allAttachments.push(...attachments.map(att => ({
        uid: message.uid,
        filename: part.disposition?.params?.filename || 'bijlage.pdf',
  buffer,
        contentType: att.contentType,
        content: att.content,
        buffer: att.content,
        base64: buffer.toString('base64') // ✅ voeg dit toe
      })));

    } catch (err) {
      console.error(`❌ Fout bij verwerken van UID ${message.uid}:`, err);
    }
  }

  return { mails, allAttachments };
}