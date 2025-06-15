// 📁 automatinglogistics-api/services/pdfService.js

import { simpleParser } from 'mailparser';

export async function findPDFs(bodyStructure, client, uid) {
  const pdfParts = [];

  try {
    console.log(`📨 Start download mail UID ${uid}`);
    const { content: rawMessage } = await client.download(uid);
    console.log(`✅ Download succesvol voor UID ${uid}`);

    const parsed = await simpleParser(rawMessage);
    const attachments = parsed.attachments || [];

    console.log(`📎 Aantal bijlages: ${attachments.length}`);

    for (const attachment of attachments) {
      console.log(`🔍 Gevonden bijlage: ${attachment.filename} (${attachment.contentType})`);

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
      console.log(`⚠️ Geen PDF-bijlagen gevonden bij UID ${uid}`);
    }

    return pdfParts;
  } catch (error) {
    console.error(`❌ Fout bij verwerken van UID ${uid}:`, error);
    return [];
  }
}