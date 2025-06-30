// parseJordex.js
import '../utils/fsPatch.js'; // ⛔️ Blokkeer testbestand vóór pdf-parse geladen wordt
import pdfParse from 'pdf-parse';
import { supabase } from '../services/supabaseClient.js';

import { getTerminalInfo } from '../utils/lookups/terminalLookup.js';
import { getRederijNaam } from '../utils/lookups/rederijLookup.js';
import { getContainerTypeCode } from '../utils/lookups/containerTypeLookup.js';
import { getKlantData } from '../utils/lookups/klantLookup.js';

export default async function parseJordex(pdfBuffer) {
  console.log('📥 Start parser...');

  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('⚠️ Geen geldig PDF-buffer ontvangen');
    return null;
  }

  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);

  console.log('📎 pdfBuffer lengte:', pdfBuffer.length);
  console.log('🧪 Eerste 100 tekens tekst:', text.slice(0, 100));

  const data = {
    referentie: extract(lines, /Our reference[:\s]*([A-Z0-9]+)/i) || '0',
    rederij: extract(lines, /Carrier[:\s]*(.+)/i) || '0',
    bootnaam: extract(lines, /Vessel[:\s]*(.+)/i) || '0',
    containertype: extract(lines, /Container type[:\s]*(\S+)/i) || '0',
    containernummer: extract(lines, /Container no[:\s]*(\S+)/i) || '0',
    temperatuur: extract(lines, /Temperature[:\s]*([\-\d]+°C)/i) || '0',
    datum: extract(lines, /Closing[:\s]*(\d{2}[-/]\d{2}[-/]\d{4})/i) || '0',
    tijd: extract(lines, /Closing[:\s]*\d{2}[-/]\d{2}[-/]\d{4}.*?(\d{2}:\d{2})/i) || '0',
    laadreferentie: extract(lines, /Pick-up reference[:\s]*(\S+)/i) || '0',
    inleverreferentie: extract(lines, /Drop-off reference[:\s]*(\S+)/i) || '0',
    inleverBestemming: extract(lines, /Final destination[:\s]*(.+)/i) || '0',
    gewicht: extract(lines, /Weight[:\s]*(\d+ ?kg)?/i) || '0',
    volume: extract(lines, /Volume[:\s]*(\d+(\.\d+)? ?m3)?/i) || '0',
    colli: extract(lines, /Colli[:\s]*(\d+)/i) || '0',
    lading: extract(lines, /Description of goods[:\s]*(.+)/i) || '0',
    imo: extract(lines, /IMO[:\s]*(\d+)/i) || '0',
    unnr: extract(lines, /UN[:\s]*(\d+)/i) || '0',
    brix: extract(lines, /Brix[:\s]*(\d+)/i) || '0',
    klantnaam: '0',
    klantadres: '0',
    klantpostcode: '0',
    klantplaats: '0',
    terminal: '0',
    rederijCode: '0',
    containertypeCode: '0',
    klantAdresVolledig: '0'
  };

  for (const line of lines) {
    if (!line.toLowerCase().includes('tiaro')) {
      if (data.klantnaam === '0' && line.match(/(b\.v\.|transport|logistics|import|group|bv)/i)) data.klantnaam = line;
      if (data.klantadres === '0' && line.match(/^\d+\w*\s+[a-z\s]+$/i)) data.klantadres = line;
      if (data.klantpostcode === '0' && line.match(/\d{4}\s?[A-Z]{2}/)) data.klantpostcode = line.match(/\d{4}\s?[A-Z]{2}/)[0];
      if (data.klantplaats === '0' && line.toLowerCase().includes('rotterdam')) data.klantplaats = 'Rotterdam';
    }
  }

  if (data.klantnaam.toLowerCase().includes('tiaro')) {
    data.klantnaam = data.klantadres = data.klantpostcode = data.klantplaats = '0';
  }

  data.terminal = await getTerminalInfo(data.referentie, supabase) || '0';
  data.rederijCode = await getRederijNaam(data.rederij, supabase) || '0';
  data.containertypeCode = await getContainerTypeCode(data.containertype, supabase) || '0';
  data.klantAdresVolledig = await getKlantData(data.klantnaam, supabase) || '0';

  Object.entries(data).forEach(([key, value]) => {
    if (!value || value === '') {
      data[key] = '0';
      console.warn(`⚠️ ${key} NIET gevonden`);
    } else {
      console.log(`✅ ${key}: ${value}`);
    }
  });

  return data;
}

function extract(lines, pattern) {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}
