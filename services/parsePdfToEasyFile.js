// parsePdfToEasyFile.js
import '../utils/fsPatch.js';
import { createClient } from '@supabase/supabase-js';
import parsePdfToJson from './parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parsePdfToEasyFile...');

  const parsedData = await parsePdfToJson(pdfBuffer);

  if (!parsedData || typeof parsedData !== 'object') {
    console.warn('⛔️ Geen geldige parserdata ontvangen');
    return '';
  }

  console.log('📄 Parsed data ontvangen:', parsedData);
  console.log('📄 JSON input voor XML-generator:\n', JSON.stringify(parsedData, null, 2));

  try {
    const xml = await generateXmlFromJson(parsedData);
    console.log('📦 XML succesvol gegenereerd');
    return xml;
  } catch (error) {
    console.error('❌ Fout tijdens XML-generatie:', error.message);
    return '';
  }
}