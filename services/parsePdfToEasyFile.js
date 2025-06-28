//.parsePdfToEasyFile.js
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

console.log('✅ SUPABASE_URL in parsePdfToEasyFile:', process.env.SUPABASE_URL); // Debug

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
  
  const { default: pdfParse } = await import('pdf-parse');
const parsed = await pdfParse(pdfBuffer);
const text = parsed.text;

const parsedData = await parseJordex(pdfBuffer, text);
console.log('📄 parsedData naar XML:', parsedData);
  const xml = await generateXmlFromJson(parsedData); // genereert string

  console.log('📦 XML gegenereerd');
  return xml;
}