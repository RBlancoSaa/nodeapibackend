// 📁 /services/parsePdfToJson.js
import pdfParse from 'pdf-parse';
import parseJordex from '../parsers/parseJordex.js';

export default async function parsePdfToJson(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    console.warn('⚠️ Ongeldige PDF-buffer');
    return {};
  }

  const parsed = await pdfParse(buffer);
  const text = parsed.text;

  // 🔍 Herken type klant
  const isJordex = text.includes('Jordex Shipping & Forwarding');

  if (isJordex) {
    console.log('🔍 Jordex PDF herkend');
    return await parseJordex(buffer);
  }

  console.warn('⚠️ Onbekende klant, geen parser uitgevoerd');
  return {};
}