// parsers/parseJordex.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfo,
  getRederijNaam,
  getContainerTypeCode,
  getKlantData,
  normalizeContainerOmschrijving,
} from '../utils/lookups/terminalLookup.js';

function formatDatum(ddmmyyyy) {
  if (!ddmmyyyy || typeof ddmmyyyy !== 'string') return '0';
  const parts = ddmmyyyy.trim().split(/[-/.\s]/);
  if (parts.length !== 3) return ddmmyyyy;
  const [dag, maand, jaar] = parts;
  return `${dag.padStart(2, '0')}-${maand.padStart(2, '0')}-${jaar}`;
}

export default async function parseJordex(pdfBuffer, klantAlias = 'jordex') {
  console.log('📦 Ontvangen pdfBuffer:', pdfBuffer?.length, 'bytes');

  // ❌ Voorkom lege of ongeldige input
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('❌ Ongeldige of ontbrekende PDF buffer');
    return null;
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }

  // 📖 PDF uitlezen en opsplitsen
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 🔍 Multi-pattern extractor: zoekt de eerste waarde die matcht op een van de patronen
  const multiExtract = (patterns) => {
    for (const pattern of patterns) {
      const found = lines.find(line => pattern.test(line));
      if (found) {
        const match = found.match(pattern);
        if (match?.[1]) {
          const result = match[1].trim();
          console.log(`🔎 Pattern match: ${pattern} ➜ ${result}`);
          return result;
        }
      }
    }
    return null;
  };

  // 📦 Blokje 'Description ... Extra Information' uitlezen voor ladingomschrijving
  const descBlockMatch = text.match(/Description\s*([\s\S]*?)Extra Information/i);
  let ladingFromBlock = '0';
  if (descBlockMatch) {
    const cleaned = descBlockMatch[1].replace(/\s+/g, ' ').trim();
    if (cleaned.length > 5) {
      ladingFromBlock = cleaned;
      console.log('📌 Lading herkend uit Description-blok:', ladingFromBlock);
    }
  }

  // 🛠️ Hierna komt het vullen van het data-object met de extracted waarden uit de PDF
  const data = {
  ritnummer: multiExtract([
  /Our reference[:\t ]+([A-Z0-9\-]+)/i
  ]) || '0',

  referentie: multiExtract([
  /Booking reference[:\t ]+([A-Z0-9\-]+)/i,
  /Pick[-\s]?up reference[:\t ]+([A-Z0-9\-]+)/i,
  /^Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i
  ]) || '0',

  rederij: multiExtract([
    /Carrier[:\t ]+(.+)/i
  ]) || '0',

  bootnaam: multiExtract([
    /Vessel[:\t ]+(.+)/i
  ]) || '0',

  containertype: multiExtract([
  /Cargo[:\t]+(.+)/i
  ]) || '0',
 
  containernummer: (() => {
  const result = multiExtract([
    /Container no[:\t ]+(\w{4}U\d{7})/i,
    /(\w{4}U\d{7})/
  ]);
  const isGeldig = /^[A-Z]{4}U\d{7}$/.test(result || '');
  return isGeldig ? result : '';
})(),

  temperatuur: multiExtract([
    /Temperature[:\t ]+([\-\d]+°C)/i
  ]) || '0',

  datum: (() => {
  const raw = multiExtract([
    /Date[:\t ]+(\d{1,2}[-/\s]\w+[-/\s]\d{4})/i,
    /Closing[:\t ]+(\d{1,2}[-/]\d{1,2}[-/]\d{4})/i
  ]);
  return formatDatum(raw || '0');
})(),

  tijd: (() => {
  const pickUpLine = lines.find(line => /Pick-up/i.test(line) && /Date[:\t ]/.test(line));
  const timeMatch = pickUpLine?.match(/(\d{2}:\d{2})/);
  return timeMatch ? timeMatch[1] : '';
})(),

  laadreferentie: multiExtract([
  /Pick[-\s]?up reference[:\t ]+(\S+)/i,
  /^Reference(?:\(s\))?[:\t ]+(\S+)/i  // ^ = moet BEGIN regel zijn
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

 lading: ladingFromBlock || multiExtract([
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


  // Data lossen of laden info
let isLossenOpdracht = false;
if (data.pickupTerminal && data.pickupTerminal !== '0' && data.dropoffTerminal === '0') {
  isLossenOpdracht = true;
  console.log('📦 Herkend als LOSSEN-opdracht (terminal → klant)');
}
if (data.dropoffTerminal && data.dropoffTerminal !== '0' && data.pickupTerminal === '0') {
  isLossenOpdracht = false;
  console.log('📦 Herkend als LADEN-opdracht (klant → terminal)');
}
if (data.pickupTerminal !== '0' && data.dropoffTerminal !== '0') {
  console.log('📦 BEIDE terminals aanwezig, opdrachttype niet 100% zeker — controleer From/To indien nodig');
}
data.isLossenOpdracht = isLossenOpdracht;

 console.log('🔎 Zoek containertypecode voor:', data.containertype);
data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';

// 🧠 Slimme fallback als beide terminals gevuld zijn
if (data.pickupTerminal !== '0' && data.dropoffTerminal !== '0') {
  const fromText = multiExtract([/From[:\t ]+(.+)/i]) || '';
  const toText = multiExtract([/To[:\t ]+(.+)/i]) || '';

  console.log(`📍 PDF richting: From = "${fromText}", To = "${toText}"`);

  if (fromText.toLowerCase().includes('rotterdam') || fromText.toLowerCase().includes('nl')) {
    data.isLossenOpdracht = false;
    console.log('📦 Richting = export → vermoedelijk LADEN-opdracht');
  } else if (toText.toLowerCase().includes('rotterdam') || toText.toLowerCase().includes('nl')) {
    data.isLossenOpdracht = true;
    console.log('📦 Richting = import → vermoedelijk LOSSEN-opdracht');
  } else {
    console.log('⚠️ Richting niet eenduidig uit From/To af te leiden');
  }
}


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
    console.log('🔍 klantAlias gebruikt bij lookup:', klantAlias);

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

 console.log('📌 Klantgegevens geladen:', {
  naam: data.opdrachtgeverNaam,
  adres: data.opdrachtgeverAdres,
  plaats: data.opdrachtgeverPlaats
});
  } catch (e) {
    console.warn('⚠️ klantAlias lookup faalt:', e);

    // ⛔️ Fallback zodat Easytrip het bestand toch accepteert
    data.opdrachtgeverNaam = klantAlias;
    data.opdrachtgeverAdres = '0';
    data.opdrachtgeverPostcode = '0';
    data.opdrachtgeverPlaats = '0';
    data.opdrachtgeverTelefoon = '0';
    data.opdrachtgeverEmail = '0';
    data.opdrachtgeverBTW = '0';
    data.opdrachtgeverKVK = '0';
  }
}
  if (!data.laadplaats && data.klantplaats && data.klantplaats !== '0') {
  data.laadplaats = data.klantplaats;
}

if (data.referentie === '0' && text.includes('Our reference:')) {
  const refMatch = text.match(/Our reference:\s*([A-Z0-9]+)/);
  if (refMatch) {
    data.referentie = refMatch[1];
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

  // 🧠 Terminalinformatie ophalen uit Supabase (na vullen van data.dropoffTerminal etc.)
  console.log('🔎 Terminalinfo ophalen uit Supabase...');
  const pickupInfo = await getTerminalInfo(data.pickupTerminal) || {};
  const dropoffInfo = await getTerminalInfo(data.dropoffTerminal) || {};
  
  // 🧠 Voorgemeld moet "Waar" of "Onwaar" zijn
const formatVoorgemeld = (value) => {
  if (!value) return 'Onwaar';
  return value.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar';
};

// 🔁 ADR afleiden op basis van UN of IMO
  data.adr = (data.imo !== '0' || data.unnr !== '0') ? 'Waar' : 'Onwaar';
  console.log('🧪 ADR bepaald als:', data.adr);

// 📦 Bouw locatiestructuur voor .easy bestand
data.locaties = [
  {
    volgorde: '0',
    actie: 'Opzetten',
    naam: data.pickupTerminal || '0',
    adres: pickupInfo.adres || '0',
    postcode: pickupInfo.postcode || '0',
    plaats: pickupInfo.plaats || '0',
    land: pickupInfo.land || 'NL',
    voorgemeld: formatVoorgemeld(pickupInfo.voorgemeld),
    aankomst_verw: '',
    tijslot_van: '',
    tijslot_tm: '',
    portbase_code: pickupInfo.portbase_code || '',
    bicsCode: pickupInfo.bicsCode || ''
  },
  {
    volgorde: '0',
    actie: data.isLossenOpdracht ? 'Lossen' : 'Laden',
    naam: data.klantnaam || '0',
    adres: data.klantadres || '0',
    postcode: data.klantpostcode || '0',
    plaats: data.klantplaats || '0',
    land: 'NL',
    voorgemeld: 'Onwaar',
    aankomst_verw: '',
    tijslot_van: '',
    tijslot_tm: '',
    portbase_code: '',
    bicsCode: ''
  },
  {
    volgorde: '0',
    actie: 'Afzetten',
    naam: data.dropoffTerminal || '0',
    adres: dropoffInfo.adres || '0',
    postcode: dropoffInfo.postcode || '0',
    plaats: dropoffInfo.plaats || '0',
    land: dropoffInfo.land || 'NL',
    voorgemeld: formatVoorgemeld(dropoffInfo.voorgemeld),
    aankomst_verw: '',
    tijslot_van: '',
    tijslot_tm: '',
    portbase_code: dropoffInfo.portbase_code || '',
    bicsCode: dropoffInfo.bicsCode || ''
  }
];

console.log('📍 Volledige locatiestructuur gegenereerd:', data.locaties);

if (!data.referentie || data.referentie === '0') {
  console.warn('❗️ Geen referentie gevonden – opdracht kan niet gegenereerd worden');
}
  return data;
}
