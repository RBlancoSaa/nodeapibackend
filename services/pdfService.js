// 📁 automatinglogistics-api/services/pdfService.js

import { simpleParser } from 'mailparser';

export async function findPDFs(bodyStructure, client, uid) {
  const pdfParts = [];

  try {
    const { content } = await client.download(uid);
    const parsed = await simpleParser(content);

    const text = (parsed.text || '') + (parsed.html || '');
    const mentionsPDF = text.toLowerCase().includes('.pdf');

    if (!mentionsPDF) {
      console.log(`📭 Mail UID ${uid} bevat geen .pdf-vermelding in tekst`);
      return [];
    }

    if (!parsed.attachments || parsed.attachments.length === 0) {
      console.log(`📭 Mail UID ${uid} bevat geen bijlages`);
      return [];
    }

    for (const attachment of parsed.attachments) {
      if (
        attachment.filename &&
        attachment.contentType === 'application/pdf'
      ) {
        pdfParts.push({
          part: attachment.filename,
          buffer: attachment.content,
        });
      }
    }
    console.log(`📨 Download start UID ${uid}`);
const { content } = await client.download(uid);
console.log(`✅ Download compleet UID ${uid}`);

const parsed = await simpleParser(content);
console.log(`🧠 Mail parsed: ${parsed.subject || 'geen subject'}, ${parsed.attachments?.length || 0} bijlages`);


    return pdfParts;
  } catch (err) {
    console.error(`❌ Fout bij findPDFs voor UID ${uid}:`, err);
    return [];
  }
}