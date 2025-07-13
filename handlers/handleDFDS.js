// 📁 handlers/handleDFDS.js
import parseDFDS from '../parsers/parseDFDS.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export async function handleDFDS({ buffer, filename }) {
  const parsedData = await parseDFDS(buffer);

  if (!parsedData.ritnummer || parsedData.ritnummer === '0') {
    throw new Error('Geen geldig ritnummer gevonden in DFDS');
  }

  const base64 = buffer.toString('base64');
  const easyFiles = [];

  for (const container of parsedData.containers) {
    const response = await fetch(`${process.env.BASE_URL}/api/generate-easy-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: parsedData.ritnummer,
        laadplaats: container.laadplaats || '0',
        pdfBestandsnaam: filename,
        skipReprocessing: false,
        originalPdfBase64: base64,
        ...container
      })
    });

    const result = await response.json();
    console.log('📤 DFDS .easy gegenereerd voor container:', result);

    easyFiles.push({
      filename: result.bestandsnaam,
      content: Buffer.from(result.xmlBase64, 'base64')
    });
  }

  await sendEmailWithAttachments({
    ritnummer: parsedData.ritnummer,
    attachments: [
      ...easyFiles,
      {
        filename,
        content: buffer
      }
    ]
  });

  return { containers: easyFiles.length };
}
