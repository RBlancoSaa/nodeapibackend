import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import parseJordex from '../parsers/parseJordex.js';

export default async function parsePdfToJson(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    console.warn('⚠️ Ongeldige of ontbrekende PDF-buffer');
    return {};
  }

  const { text } = await pdfParse(buffer);

  if (!text?.trim()) {
    console.warn('⚠️ Lege of ongeldige tekstinhoud in PDF');
    return {};
  }

  console.log('📄 Eerste 500 tekens tekst:\n', text.slice(0, 500));

  if (text.includes('Jordex Shipping & Forwarding')) {
    console.log('🔍 Jordex PDF herkend');
    return await parseJordex(buffer, 'jordex');
  }

  // ✨ Voorbereid op andere klanten (later toe te voegen)
  console.warn('⚠️ Onbekende klant – geen parser uitgevoerd');
  return {};
}
