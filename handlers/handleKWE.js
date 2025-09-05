// handlers/handleKWE.js
import parseKWE from '../parsers/parseKWE.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export default async function handleKWE({ buffer, base64, filename }) {
  console.log(`📦 Verwerken van KWE-bestand: ${filename}`);
  const parsedData = await parseKWE(buffer);
  const easyFiles = [];

  for (const container of parsedData.containers) {
    try {
      const response = await fetch(`${process.env.BASE_URL}/api/generate-easy-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: parsedData.ritnummer || '0',
          laadplaats: container.laadplaats || '0',
          pdfBestandsnaam: filename,
          skipReprocessing: false,
          originalPdfBase64: base64,
          ...container
        })
      });

      const result = await response.json();
      console.log('📤 .easy gegenereerd voor KWE-container:', result);

      easyFiles.push({
        filename: result.bestandsnaam,
        xmlBase64: result.xmlBase64
      });

    } catch (err) {
      console.warn('⚠️ Fout bij KWE .easy-generatie:', err.message);
    }
  }

  try {
    await sendEmailWithAttachments({
      ritnummer: parsedData.ritnummer,
      attachments: [
        ...easyFiles.map(file => ({
          filename: file.filename,
          content: Buffer.from(file.xmlBase64, 'base64')
        })),
        {
          filename,
          content: Buffer.from(base64, 'base64')
        }
      ]
    });
    console.log(`✅ Mail verstuurd voor rit ${parsedData.ritnummer}`);
  } catch (err) {
    console.error('📧 Fout bij e-mailverzending KWE:', err.message);
  }
}