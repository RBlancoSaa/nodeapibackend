// 📁 automatinglogistics-api/services/pdfService.js

import { simpleParser } from 'mailparser';

export async function findPDFs(bodyStructure, client, uid) {
  const attachmentsToSave = [];

  try {
    console.log(`📨 Ophalen mail UID ${uid}`);
    const { content: raw } = await client.download(uid);
    const parsed = await simpleParser(raw);

    const attachments = parsed.attachments || [];
    console.log(`📎 Gevonden bijlages: ${attachments.length}`);

    for (const attachment of attachments) {
      const { filename, contentType, content } = attachment;

      const safeName = filename?.replace(/\s+/g, '_') || `bijlage-${uid}`;
      attachmentsToSave.push({
        part: safeName,
        buffer: content,
        contentType
      });

      console.log(`✅ Bijlage toegevoegd: ${safeName} (${contentType})`);
    }

    if (attachmentsToSave.length === 0) {
      console.warn(`⚠️ Geen bijlagen gevonden in UID ${uid}`);
    }

    return attachmentsToSave;
  } catch (error) {
    console.error(`❌ Fout bij verwerken UID ${uid}:`, error);
    return [];
  }
}