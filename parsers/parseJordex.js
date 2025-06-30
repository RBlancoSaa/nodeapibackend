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
    referentie: multiExtract([/Our reference[:\s]*([A-Z0-9]+)/i]) || '0',
    rederij: multiExtract([/Carrier[:\s]*(.+)/i]) || '0',
    bootnaam: multiExtract([/Vessel[:\s]*(.+)/i]) || '0',
    containertype: multiExtract([/Container type[:\s]*([A-Z0-9]{4})/i, /Cargo[:\s]*.*?(\d{2}[GRU1]+)/i]) || '0',
    containernummer: multiExtract([/Container no[:\s]*(\w{4}U\d{7})/i, /(\w{4}U\d{7})/]) || '0',
    temperatuur: multiExtract([/Temperature[:\s]*([\-\d]+°C)/i]) || '0',
    datum: multiExtract([/Date[:\s]*(\d{2}\s\w+\s\d{4})/i, /Closing[:\s]*(\d{2}[-/]\d{2}[-/]\d{4})/i]) || '0',
    tijd: multiExtract([/\b(\d{2}:\d{2})\b/]) || '0',
    laadreferentie: multiExtract([/Pick-up reference[:\s]*(\S+)/i]) || '0',
    inleverreferentie: multiExtract([/Drop-off reference[:\s]*(\S+)/i]) || '0',
    inleverBestemming: multiExtract([/Final destination[:\s]*(.+)/i]) || '0',
    dropoffTerminal: multiExtract([/Drop[-\s]?off terminal[:\s]*(.+)/i]) || '0',
    pickupTerminal: multiExtract([/Pick[-\s]?up terminal[:\s]*(.+)/i]) || '0',
    gewicht: multiExtract([/Weight[:\s]*(\d+\s?kg)/i]) || '0',
    volume: multiExtract([/Volume[:\s]*(\d+(\.\d+)?\s?m3)/i]) || '0',
    colli: multiExtract([/Colli[:\s]*(\d+)/i]) || '0',
    lading: multiExtract([/Description of goods[:\s]*(.+)/i]) || '0',
    imo: multiExtract([/IMO[:\s]*(\d+)/i]) || '0',
    unnr: multiExtract([/UN[:\s]*(\d+)/i]) || '0',
    brix: multiExtract([/Brix[:\s]*(\d+)/i]) || '0',
    klantnaam: '0', klantadres: '0', klantpostcode: '0', klantplaats: '0', klantAdresVolledig: '0',
    terminal: '0', rederijCode: '0', containertypeCode: '0'
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
      data.klantAdresVolledig = klant.volledig || '0';
      console.log('📌 Klantgegevens geladen via alias:', klantAlias);
    } catch (e) {
      console.warn('⚠️ klantAlias lookup faalt:', e);
    }
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
