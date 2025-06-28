// Bovenaan eerst fs fixen vóór import pdf-parse
import fs from 'fs';

// Blokkeer test-bestand (voorkomt ENOENT in pdf-parse)
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

// Pas daarna importeren
import pdfParse from 'pdf-parse';
import parseJordex from '../parsers/parseJordex.js';

export default async function parsePdfToJson(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    console.warn('⚠️ Ongeldige PDF-buffer');
    return {};
  }

  const parsed = await pdfParse(buffer);
  const text = parsed.text;

  const isJordex = text.includes('Jordex Shipping & Forwarding');
  if (isJordex) {
    console.log('🔍 Jordex PDF herkend');
    return await parseJordex(buffer, text);
  }

  console.warn('⚠️ Onbekende klant, geen parser uitgevoerd');
  return {};
}