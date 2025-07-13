  // parsePdftoJson

import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';

import parseJordex from '../parsers/parseJordex.js';
import parseNeelevat from '../parsers/parseNeelevat.js';
import parseB2L from '../parsers/parseB2L.js';
import parseDFDS from '../parsers/parseDFDS.js';
import parseEasyfresh from '../parsers/parseEasyfresh.js';
import parseKWE from '../parsers/parseKWE.js';
import parseRitra from '../parsers/parseRitra.js';

function cleanTekst(input) {
  if (typeof input !== 'string') return input;

  let result = input
    .replace(/’|‘|´/g, "'")        // slimme apostroffen → standaard
    .replace(/“|”/g, '"');         // slimme quotes → ASCII quote

  // ✅ Strip apostrof aan begin van adres (alleen als het adres met 't begint)
  result = result.replace(/^['’‘´`]t\s/i, "t ");

  return result;
}

export default async function parsePdfToJson(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    console.warn('⚠️ Ongeldige of ontbrekende PDF-buffer');
    return {};
  }

  const { text: rawText } = await pdfParse(buffer);
const text = cleanTekst(rawText);
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

  // herken DFDS op: nl-rtm-operations@dfds.com of 'DFDS Warehousing Rotterdam B.V.'
const textLower = text.toLowerCase();

if (
  textLower.includes('dfds') ||
  textLower.includes('estron') ||
  textLower.includes('nl-rtm-operations@dfds.com') ||
  textLower.includes('dfds warehousing rotterdam b.v.') ||
  textLower.includes('@dfds.com')
) {
 return await parseDFDS(buffer);
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
