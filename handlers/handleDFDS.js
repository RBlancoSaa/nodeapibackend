// 📁 handlers/handleDFDS.js
import parseDFDS from '../parsers/parseDFDS.js';
import generateXmlFromJson from '../services/generateXmlFromJson.js';
import uploadToSupabase from '../services/uploadToSupabase.js';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';

export default async function handleDFDS(pdfBuffer, originalFilename) {
  const containers = await parseDFDS(pdfBuffer);
  const results = [];

  for (const containerData of containers) {
    const xml = await generateXmlFromJson(containerData);

    const bestandsnaam = `Order_${containerData.referentie}_${containerData.locaties[0].plaats}.easy`;
    const bestandBuffer = Buffer.from(xml, 'utf-8');

    const uploadResult = await uploadToSupabase({
      bestandBuffer,
      bestandNaam: bestandsnaam,
      contentType: 'text/plain',
      subfolder: 'easytrip'
    });

    results.push({
      bestandNaam: bestandsnaam,
      xmlVoorbeeld: xml.slice(0, 300),
      uploadResult
    });
  }

  return results;
}