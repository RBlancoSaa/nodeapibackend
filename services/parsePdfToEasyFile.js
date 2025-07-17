// 📁 parsePdfToEasyFile.js
import '../utils/fsPatch.js';
import parsePdfToJson from './parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parsePdfToEasyFile...');

  const parsedContainers = await parsePdfToJson(pdfBuffer);

  if (!Array.isArray(parsedContainers) || parsedContainers.length === 0) {
    console.warn('⛔️ Geen containers gevonden in parserdata');
    return [];
  }

  const easyXmlList = [];

  for (const containerData of parsedContainers) {
    try {
      console.log('📦 XML input per container:', JSON.stringify(containerData, null, 2));
      const xml = await generateXmlFromJson(containerData);
      easyXmlList.push(xml);
    } catch (err) {
      console.error(`❌ Fout tijdens XML-generatie voor container ${containerData.containernummer || '[onbekend]'}`, err.message);
    }
  }

  console.log(`✅ Aantal gegenereerde XML-bestanden: ${easyXmlList.length}`);
  return easyXmlList;
}