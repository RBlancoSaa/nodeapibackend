// 📁 automatinglogistics-api/services/pdfService.js

import { simpleParser } from 'mailparser';

export async function findPDFs(bodyStructure, client, uid) {
  const pdfParts = [];

  try {
    console.log(`📨 Start download van e-mail UID ${uid}`);
    const { content: mailContent } = await client.download(uid);
    console.log(`✅ Download compleet UID ${uid}`);

    const parsed = await simpleParser(mailContent);
    console.log(`🧠 Mail parsed: ${parsed.subject || 'geen subject'}, ${parsed.attachments?.length || 0} bijlages`);

    if (!parsed.attachments || parsed.attachments.length === 0) {
      console.log(`📭 Mail UID ${uid} bevat geen bijlages`);
      return [];
    }

    for (const attachment of parsed.attachments) {
      console.log(`🔎 Gevonden bijlage: ${attachment.filename} (${attachment.contentType})`);

      if (
        attachment.filename &&
        attachment.contentType === 'application/pdf'
      ) {
        pdfParts.push({
          part: attachment.filename,
          buffer: attachment.content,
        });
        console.log(`✅ PDF bijlage toegevoegd: ${attachment.filename}`);
      }
    }

    if (pdfParts.length === 0) {
      console.log(`❗ Geen geldige PDF-bijlagen gevonden bij UID ${uid}`);
    }

    return pdfParts;
  } catch (err) {
    console.error(`❌ Fout bij verwerken van UID ${uid}:`, err);
    return [];
  }
}
