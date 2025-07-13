// handlers/handleNeelevat.js
import parseNeelevat from '../parsers/parseNeelevat.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export default async function handleNeelevat({ buffer, base64, filename }) {
  console.log(`📦 Verwerken van Neelevat-bestand: ${filename}`);
  const parsedData = await parseNeelevat(buffer);
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
      console.log('📤 .easy gegenereerd voor Neelevat-container:', result);

      easyFiles.push({
        filename: result.bestandsnaam,
        xmlBase64: result.xmlBase64
      });

    } catch (err) {
      console.warn('⚠️ Fout bij Neelevat .easy-generatie:', err.message);
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
    console.error('📧 Fout bij e-mailverzending Neelevat:', err.message);
  }
}