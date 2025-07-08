import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';

import parseJordex from '../parsers/parseJordex.js';
import parseNeelevat from '../parsers/parseNeelevat.js';
import parseB2L from '../parsers/parseB2L.js';
import parseDFDS from '../parsers/parseDFDS.js';
import parseEasyfresh from '../parsers/parseEasyfresh.js';
import parseKWE from '../parsers/parseKWE.js';
import parseRitra from '../parsers/parseRitra.js';

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

  // 🔍 Klantdectectie op basis van tekst
  if (text.includes('Jordex Shipping & Forwarding')) {
    console.log('🔍 Jordex PDF herkend');
    return await parseJordex(buffer, 'jordex');
  }

  if (text.includes('Neele-Vat') || text.includes('Neelevat')) {
    console.log('🔍 Neelevat PDF herkend');
    return await parseNeelevat(buffer, 'neelevat');
  }

  if (text.includes('B2L Cargocare') || text.includes('B2L')) {
    console.log('🔍 B2L PDF herkend');
    return await parseB2L(buffer, 'b2l');
  }

  if (text.includes('DFDS')) {
    console.log('🔍 DFDS PDF herkend');
    return await parseDFDS(buffer, 'dfds');
  }

  if (text.includes('Easyfresh')) {
    console.log('🔍 Easyfresh PDF herkend');
    return await parseEasyfresh(buffer, 'easyfresh');
  }

  if (text.includes('Kintetsu World Express') || text.includes('KWE')) {
    console.log('🔍 KWE PDF herkend');
    return await parseKWE(buffer, 'kwe');
  }

  if (text.includes('Ritra')) {
    console.log('🔍 Ritra PDF herkend');
    return await parseRitra(buffer, 'ritra');
  }

  console.warn('⚠️ Onbekende klant; geen parser uitgevoerd');
  return {};
}