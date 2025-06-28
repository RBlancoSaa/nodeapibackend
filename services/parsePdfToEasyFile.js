import fs from 'fs';
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

import { createClient } from '@supabase/supabase-js';
import pdfParse from 'pdf-parse';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parser...');

  // ✅ Eerst pdfParse doen
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;

  // ✅ Daarna doorgeven aan parseJordex
  const parsedData = await parseJordex(pdfBuffer, text);

  const xml = await generateXmlFromJson(parsedData); // genereert string
  console.log('📦 XML gegenereerd');
  return xml;
}
