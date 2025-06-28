import pdfParse from 'pdf-parse';
import parseJordex from '../parsers/parseJordex.js';
const { default: pdfParse } = await import('pdf-parse');
const parsed = await pdfParse(pdfBuffer);
const text = parsed.text;

return await parseJordex(pdfBuffer, text);
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
    // 🧠 Geef zowel buffer als tekst mee
    return await parseJordex(buffer, text);
  }

  console.warn('⚠️ Onbekende klant, geen parser uitgevoerd');
  return {};
}