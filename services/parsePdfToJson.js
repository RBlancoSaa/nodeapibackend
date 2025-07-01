import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import parseJordex from '../parsers/parseJordex.js';

export default async function parsePdfToJson(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    console.warn('⚠️ Ongeldige PDF-buffer');
    return {};
  }

  const parsed = await pdfParse(buffer);
  const text = parsed.text;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.warn('⚠️ Lege of ongeldige tekstinhoud in PDF');
    return {};
  }

  const isJordex = text.includes('Jordex Shipping & Forwarding');

  if (isJordex) {
    console.log('🔍 Jordex PDF herkend');
    console.log('📄 TEXT IN PDF:\n', text.slice(0, 500));
    return await parseJordex(buffer, text);
  }

  console.warn('⚠️ Onbekende klant, geen parser uitgevoerd');
  return {};
}
