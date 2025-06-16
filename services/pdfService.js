// 📁 automatinglogistics-api/services/pdfService.js

import { simpleParser } from 'mailparser';

export async function findPDFs(bodyStructure, client, uid) {
  const pdfParts = [];

  try {
    console.log(`📩 Start ophalen mail UID ${uid}`);
    const { content: raw } = await client.download(uid);

    const parsed = await simpleParser(raw);
    const attachments = parsed.attachments || [];

    console.log(`🔍 Bijlages gevonden: ${attachments.length}`);

    for (const attachment of attachments) {
      const { filename, contentType, content } = attachment;

      if (contentType === 'application/pdf') {
        pdfParts.push({
          part: filename || `bijlage-${uid}.pdf`,
          buffer: content,
        });

        console.log(`✅ PDF bijlage herkend: ${filename}`);
      } else {
        console.log(`⛔ Niet-PDF overgeslagen: ${filename} (${contentType})`);
      }
    }

    if (pdfParts.length === 0) {
      console.warn(`⚠️ Geen PDF-bijlagen aangetroffen in UID ${uid}`);
    }

    return pdfParts;
  } catch (error) {
    console.error(`❌ Fout bij verwerken UID ${uid}:`, error);
    return [];
  }
}
