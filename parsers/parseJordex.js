// parsers/parseJordex.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfo,
  getRederijNaam,
  getContainerTypeCode,
  getKlantData
} from '../utils/lookups/terminalLookup.js';

export default async function parseJordex(pdfBuffer, klantAlias = 'jordex') {
  console.log('📦 Ontvangen pdfBuffer:', pdfBuffer?.length, 'bytes');

if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 100) {
  console.warn('❌ Lege of ongeldige PDF buffer ontvangen');
  return {};
}
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) return null;

  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const multiExtract = (patterns) => {
    for (const pattern of patterns) {
      const found = lines.find(line => pattern.test(line));
      if (found) {
        const match = found.match(pattern);
        if (match?.[1]) return match[1].trim();
      }
    }
    return null;
  };

  const data = {
  referentie: multiExtract([
    /Our reference[:\t ]+([A-Z0-9\-]+)/i,
    /Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i
  ]) || '0',

  rederij: multiExtract([
    /Carrier[:\t ]+(.+)/i
  ]) || '0',

  bootnaam: multiExtract([
    /Vessel[:\t ]+(.+)/i
  ]) || '0',

  containertype: multiExtract([
    /Container type[:\t ]+([A-Z0-9]{4})/i,
    /Cargo[:\t ]+.*?(\d{2}[GRU1]+)/i
  ]) || '0',

  containernummer: multiExtract([
    /Container no[:\t ]+(\w{4}U\d{7})/i,
    /(\w{4}U\d{7})/
  ]) || '0',

  temperatuur: multiExtract([
    /Temperature[:\t ]+([\-\d]+°C)/i
  ]) || '0',

  datum: multiExtract([
    /Date[:\t ]+(\d{2}\s\w+\s\d{4})/i,
    /Closing[:\t ]+(\d{2}[-/]\d{2}[-/]\d{4})/i
  ]) || '0',

  tijd: multiExtract([
    /\b(\d{2}:\d{2})\b/
  ]) || '0',

  laadreferentie: multiExtract([
    /Pick[-\s]?up reference[:\t ]+(\S+)/i,
    /Reference(?:\(s\))?[:\t ]+(\S+)/i
  ]) || '0',

  inleverreferentie: multiExtract([
    /Drop[-\s]?off reference[:\t ]+(\S+)/i
  ]) || '0',

  inleverBestemming: multiExtract([
    /Final destination[:\t ]+(.+)/i
  ]) || '0',

  dropoffTerminal: multiExtract([
    /Drop[-\s]?off terminal[:\t ]+(.+)/i
  ]) || '0',

  pickupTerminal: multiExtract([
    /Pick[-\s]?up terminal[:\t ]+(.+)/i
  ]) || '0',

  gewicht: multiExtract([
    /Weight[:\t ]+(\d+\s?kg)/i
  ]) || '0',

  volume: multiExtract([
    /Volume[:\t ]+(\d+(?:\.\d+)?\s?m3)/i
  ]) || '0',

  colli: multiExtract([
    /Colli[:\t ]+(\d+)/i
  ]) || '0',

  lading: multiExtract([
    /Description of goods[:\t ]+(.+)/i,
    /Cargo[:\t ]+(.+)/i
  ]) || '0',

  imo: multiExtract([
    /IMO[:\t ]+(\d+)/i
  ]) || '0',

  unnr: multiExtract([
    /UN[:\t ]+(\d+)/i
  ]) || '0',

  brix: multiExtract([
    /Brix[:\t ]+(\d+)/i
  ]) || '0',

    klantnaam: '0',
    klantadres: '0',
    klantpostcode: '0',
    klantplaats: '0',
    klantAdresVolledig: '0',
    opdrachtgeverNaam: '0',
    opdrachtgeverAdres: '0',
    opdrachtgeverPostcode: '0',
    opdrachtgeverPlaats: '0',
    opdrachtgeverTelefoon: '0',
    opdrachtgeverEmail: '0',
    opdrachtgeverBTW: '0',
    opdrachtgeverKVK: '0',
    terminal: '0',
    rederijCode: '0',
    containertypeCode: '0'
};

  // ✅ Klantgegevens geforceerd instellen obv alias
  if (klantAlias) {
    // 🔁 Alias normaliseren
    const klantAliasMap = {
      'jordex': 'JORDEX FORWARDING',
      'jordex forwarding': 'JORDEX FORWARDING',
      'jordex chartering': 'JORDEX CHARTERING & PROJECTS',
      'tiaro': 'Tiaro Transport',
      'tiaro transport': 'Tiaro Transport'
    };
    klantAlias = klantAliasMap[klantAlias.toLowerCase()] || klantAlias;

try {
      const klant = await getKlantData(klantAlias);
      data.klantnaam = klant.naam || klantAlias;
      data.klantadres = klant.adres || '0';
      data.klantpostcode = klant.postcode || '0';
      data.klantplaats = klant.plaats || '0';
      data.telefoon = klant.telefoon || '0';
      data.email = klant.email || '0';
      data.btw = klant.btw || '0';
      data.kvk = klant.kvk || '0';
      data.klantAdresVolledig = klant.volledig || '0';

      // 🔁 Zet klantgegevens om naar opdrachtgevervelden
      data.opdrachtgeverNaam = data.klantnaam;
      data.opdrachtgeverAdres = data.klantadres;
      data.opdrachtgeverPostcode = data.klantpostcode;
      data.opdrachtgeverPlaats = data.klantplaats;
      data.opdrachtgeverTelefoon = data.telefoon;
      data.opdrachtgeverEmail = data.email;
      data.opdrachtgeverBTW = data.btw;
      data.opdrachtgeverKVK = data.kvk;

      console.log('📌 Klantgegevens geladen via alias:', klantAlias);
    } catch (e) {
      console.warn('⚠️ klantAlias lookup faalt:', e);
    }
       // ⛔️ Fallback instellen om Easytrip error te voorkomen
  data.klantnaam = klantAlias || 'ONBEKEND';
  data.klantadres = '0';
  data.klantpostcode = '0';
  data.klantplaats = '0';
  data.telefoon = '0';
  data.email = '0';
  data.btw = '0';
  data.kvk = '0';
  data.klantAdresVolledig = '0';

  // 🔁 Zet alsnog de opdrachtgevervelden
  data.opdrachtgeverNaam = data.klantnaam;
  data.opdrachtgeverAdres = data.klantadres;
  data.opdrachtgeverPostcode = data.klantpostcode;
  data.opdrachtgeverPlaats = data.klantplaats;
  data.opdrachtgeverTelefoon = data.telefoon;
  data.opdrachtgeverEmail = data.email;
  data.opdrachtgeverBTW = data.btw;
  data.opdrachtgeverKVK = data.kvk;

  console.warn(`⚠️ Fallback gebruikt voor klantAlias: ${data.klantnaam}`);
}
  
  try {
    const baseRederij = data.rederij.includes(' - ') ? data.rederij.split(' - ')[1] : data.rederij;
    console.log('🔎 Zoek rederijcode voor:', baseRederij);
    data.rederijCode = await getRederijNaam(baseRederij) || '0';
  } catch (e) {
    console.warn('⚠️ rederij lookup faalt:', e);
  }

  try {
    console.log('🔎 Zoek terminalinfo voor:', data.dropoffTerminal);
    data.terminal = await getTerminalInfo(data.dropoffTerminal) || '0';
  } catch (e) {
    console.warn('⚠️ terminal lookup faalt:', e);
  }

  try {
    console.log('🔎 Zoek containertypecode voor:', data.containertype);
    data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';
  } catch (e) {
    console.warn('⚠️ containertype lookup faalt:', e);
  }

  for (const [key, val] of Object.entries(data)) {
    if (!val || val === '') {
      data[key] = '0';
      console.warn(`⚠️ ${key} NIET gevonden`);
    } else {
      console.log(`✅ ${key}: ${val}`);
    }
  }

  return data;
}
