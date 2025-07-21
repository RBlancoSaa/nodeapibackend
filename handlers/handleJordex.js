// 📁 handlers/handleJordex.js
import parseJordex from '../parsers/parseJordex.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export default async function handleJordex({ buffer, base64, filename }) {
  console.log(`📦 Verwerken van Jordex-bestand: ${filename}`);

  const parsedData = await parseJordex(buffer);
  const easyFiles = [];

  const containers = Array.isArray(parsedData) ? parsedData : [parsedData];

  for (const data of containers) {
    if (!data.ritnummer || data.ritnummer === '0') {
      console.warn('⚠️ Ongeldig ritnummer, container wordt overgeslagen:', data.containernummer || '[GEEN]');
      continue;
    }

    try {
      const response = await fetch(`${process.env.BASE_URL}/api/generate-easy-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: data.referentie || '0',
          laadplaats: data.laadplaats || '0',
          pdfBestandsnaam: filename,
          skipReprocessing: false,
          originalPdfBase64: base64,
          ...data
        })
      });

      const result = await response.json();
      console.log(`📤 .easy-bestand gegenereerd voor container ${data.containernummer}:`, result);

      easyFiles.push({
        filename: result.bestandsnaam,
        xmlBase64: result.xmlBase64
      });

    } catch (err) {
      console.error(`❌ Fout bij .easy-generatie voor container ${data.containernummer || 'onbekend'}:`, err.message);
    }
  }

  try {
    await sendEmailWithAttachments({
      ritnummer: containers[0]?.ritnummer || 'onbekend',
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