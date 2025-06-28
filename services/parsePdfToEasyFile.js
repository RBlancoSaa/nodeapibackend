//.parsePdfToEasyFile.js
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import parsePdfToJson from './parsePdfToJson.js'; // tussenlaag met pdf-parse
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
  console.log('📥 Start parser via parsePdfToJson...');

  const parsedData = await parsePdfToJson(pdfBuffer); // bevat text
  const xml = await generateXmlFromJson(parsedData);  // genereert .easy XML

  console.log('📦 XML gegenereerd');
  return xml;
}
