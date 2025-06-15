// 📁 automatinglogistics-api/services/pdfService.js

import { simpleParser } from 'mailparser';

export async function findPDFs(bodyStructure, client, uid) {
  const pdfParts = [];

  try {
    const { content } = await client.download(uid);
    const parsed = await simpleParser(content);

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

    return pdfParts;
  } catch (err) {
    console.error(`❌ Fout bij findPDFs voor UID ${uid}:`, err);
    return [];
  }
}
