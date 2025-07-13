// 📁 handlers/handleJordex.js
import parseJordex from '../parsers/parseJordex.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export default async function handleJordex({ buffer, base64, filename }) {
  console.log(`📦 Verwerken van Jordex-bestand: ${filename}`);

  const parsedData = await parseJordex(buffer);
  const easyFiles = [];

  if (!parsedData.ritnummer || parsedData.ritnummer === '0') {
    throw new Error('❌ Geen geldig ritnummer gevonden voor Jordex');
  }

  try {
    const response = await fetch(`${process.env.BASE_URL}/api/generate-easy-files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: parsedData.referentie || '0',
        laadplaats: parsedData.laadplaats || '0',
        pdfBestandsnaam: filename,
        skipReprocessing: false,
        originalPdfBase64: base64,
        ...parsedData
      })
    });

    const result = await response.json();
    console.log('📤 Jordex .easy-bestand gegenereerd:', result);

    easyFiles.push({
      filename: result.bestandsnaam,
      xmlBase64: result.xmlBase64
    });

  } catch (err) {
    console.error('⚠️ Fout bij Jordex .easy-generatie:', err.message);
    return;
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
    console.error('📧 Fout bij e-mailverzending Jordex:', err.message);
  }
}