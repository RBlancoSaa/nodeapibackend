// 📁 handlers/handleDFDS.js
import parseDFDS from '../parsers/parseDFDS.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export default async function handleDFDS({ buffer, base64, filename }) {
  console.log(`📦 Verwerken van DFDS-bestand: ${filename}`);

  const containers = await parseDFDS(buffer);
  const easyFiles = [];

  if (!containers || containers.length === 0) {
    throw new Error('❌ Geen containers gevonden voor DFDS');
  }

  for (const containerData of containers) {
    try {
      const response = await fetch(`${process.env.BASE_URL}/api/generate-easy-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: containerData.referentie || '0',
          laadplaats: containerData.locaties?.[0]?.plaats || 'Onbekend',
          pdfBestandsnaam: filename,
          skipReprocessing: false,
          originalPdfBase64: base64,
          ...containerData
        })
      });

      const result = await response.json();
      console.log('📤 DFDS .easy-bestand gegenereerd:', result);

      easyFiles.push({
        filename: result.bestandsnaam,
        xmlBase64: result.xmlBase64
      });

    } catch (err) {
      console.error('⚠️ Fout bij DFDS .easy-generatie:', err.message);
    }
  }

  try {
    await sendEmailWithAttachments({
      ritnummer: containers[0].ritnummer || '0',
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
    console.log(`✅ Mail verstuurd voor DFDS rit ${containers[0].ritnummer}`);
  } catch (err) {
    console.error('📧 Fout bij e-mailverzending DFDS:', err.message);
  }
}