// 📁 handlers/handleJordex.js
import parseJordex from '../parsers/parseJordex.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export default async function  handleJordex({ buffer, filename }) {
  const parsedData = await parseJordex(buffer);

  if (!parsedData.ritnummer || parsedData.ritnummer === '0') {
    throw new Error('Geen geldig ritnummer gevonden');
  }

  const response = await fetch(`${process.env.BASE_URL}/api/generate-easy-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reference: parsedData.referentie,
      laadplaats: parsedData.laadplaats || '0',
      pdfBestandsnaam: filename,
      skipReprocessing: false,
      originalPdfBase64: buffer.toString('base64'),
      ...parsedData
    })
  });

  const result = await response.json();
  console.log('📤 Jordex .easy-bestand gegenereerd:', result);

  await sendEmailWithAttachments({
    ritnummer: parsedData.ritnummer,
    attachments: [
      {
        filename: result.bestandsnaam,
        content: Buffer.from(result.xmlBase64, 'base64')
      },
      {
        filename,
        content: buffer
      }
    ]
  });

  return result;
}
