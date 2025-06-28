import parsePdfToJson from './parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parser via parsePdfToJson...');

  const parsedData = await parsePdfToJson(pdfBuffer); // bevat text
  const xml = await generateXmlFromJson(parsedData);  // genereert .easy XML

  console.log('📦 XML gegenereerd');
  return xml;
}