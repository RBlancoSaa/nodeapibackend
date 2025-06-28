//.parsePdfToEasyFile.js
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

console.log('✅ SUPABASE_URL in parsePdfToEasyFile:', process.env.SUPABASE_URL); // Debug

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ⛔️ Testbestand blokkeren
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parser...');

  // ✅ Haal tekst uit PDF
  const { default: pdfParse } = await import('pdf-parse');
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;

  if (!parsed || !text) {
    console.warn('⚠️ Geen tekst uit PDF gehaald');
    return '';
  }

  // ✅ Geef buffer én tekst door aan parser
  const parsedData = await parseJordex(pdfBuffer, text);

  console.log('📄 parsedData naar XML:', parsedData); // Debug
console.log('🔍 parsedData:', parsedData);

  const xml = await generateXmlFromJson(parsedData); // Genereer XML-string

  console.log('📦 XML gegenereerd');
  return xml;
}