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
  const months = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };
  const parts = ddmmyyyy.trim().split(/[-/.\s]/);
  if (parts.length !== 3) return '0';

  let [dag, maand, jaar] = parts;
  maand = maand.length === 3 ? months[maand.toLowerCase()] : maand.padStart(2, '0');
  return `${dag.padStart(2, '0')}-${maand}-${jaar}`;
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
// 📍 Ritnummer: vind OE- of OI-code los van context
const ritnummerMatch = text.match(/\b(O[EI]\d{7})\b/i);

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
// 🟢 Pick-up terminal → <Referentie>
referentie: (() => {
  const pickupBlockMatch = text.match(/Pick[-\s]?up terminal:\s*([\s\S]+?)Drop[-\s]?off terminal:/i);
  if (pickupBlockMatch) {
    const match = pickupBlockMatch[1].match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || '0';
  }
  return '0';
})(),

// 🟢 Pick-up (klant) → <Laadreferentie>
laadreferentie: (() => {
  const klantBlock = text.match(/Pick[-\s]?up:\s*([\s\S]+?)Drop[-\s]?off:/i);
  if (klantBlock) {
    const match = klantBlock[1].match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || '0';
  }
  return '0';
})(),

// 🟢 Drop-off terminal → <Inleverreferentie>
inleverreferentie: (() => {
  const dropoffBlock = text.match(/Drop[-\s]?off terminal:\s*([\s\S]+?)Failure/i);
  if (dropoffBlock) {
    const match = dropoffBlock[1].match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || '0';
  }
  return '0';
})(),

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
  /Container No\.?[:\t ]+(\w{4}U\d{7})/i,
  /Container number[:\t ]+(\w{4}U\d{7})/i,
  /Container nr[:\t ]+(\w{4}U\d{7})/i,
  /Cont nr[:\t ]+(\w{4}U\d{7})/i,
  /Cont[:\t ]+(\w{4}U\d{7})/i,
  /(\w{4}U\d{7})/, // alleen het nummer
  /([A-Z]{4}\d{7})/i // fallback: alleen letters/cijfers
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

// ZZ: Zoek tijd direct achter een datum in alle regels
tijd: (() => {
  const klantBlock = text.match(/Pick[-\s]?up:\s*([\s\S]+?)Drop[-\s]?off:/i);
  if (klantBlock) {
    const match = klantBlock[1].match(/Date[:\t ]+(\d{1,2}\s+\w+\s+\d{4})\s+(\d{2}:\d{2})/i);
    if (match) {
      const tijd = match[2];
      return `${tijd}:00`; // omzetten naar 07:00:00
    }
  }
  return '';
})(),

  laadreferentie: (() => {
  const klantBlock = text.match(/Pick[-\s]?up:\s*([\s\S]+?)Drop[-\s]?off:/i);
  if (klantBlock) {
    const match = klantBlock[1].match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || '0';
  }
  return '0';
})(),

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
  opdrachtgeverNaam: 'JORDEX FORWARDING',
  opdrachtgeverAdres: 'AMBACHTSWEG 6',
  opdrachtgeverPostcode: '3161GL',
  opdrachtgeverPlaats: 'RHOON',
  opdrachtgeverTelefoon: '010-3037303',
  opdrachtgeverEmail: 'TRANSPORT@JORDEX.COM',
  opdrachtgeverBTW: 'NL815340011B01',
  opdrachtgeverKVK: '24390991',
    terminal: '0',
    rederijCode: '0',
    containertypeCode: '0'
};


// 🧠 Klantgegevens ophalen uit Pick-up blok
const klantblok = text.match(/Pick[-\s]?up:\s*([\s\S]+?)Drop[-\s]?off:/i);
if (klantblok) {
  const regels = klantblok[1].trim().split('\n').map(l => l.trim()).filter(Boolean);
  data.klantBedrijf = regels[0] || '';
  data.klantAdres = regels[1] || '';
  const postcodeMatch = regels[2]?.match(/(\d{4}\s?[A-Z]{2})\s+(.+)/);
  data.klantPostcode = postcodeMatch?.[1] || '';
  data.klantPlaats = postcodeMatch?.[2] || '';
}

  // Data lossen of laden info
if (text.includes('Pick-up terminal')) {
  data.ladenOfLossen = 'Laden';
} else if (text.includes('Drop-off terminal')) {
  data.ladenOfLossen = 'Lossen';
} else {
  data.ladenOfLossen = '';
}

 console.log('🔎 Zoek containertypecode voor:', data.containertype);
data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';
data.isLossenOpdracht = !!data.containernummer && data.containernummer !== '0';

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

    // 🔁 Zet klantgegevens om naar opdrachtgevervelden
data.opdrachtgeverNaam = 'JORDEX FORWARDING';
data.opdrachtgeverAdres = 'AMBACHTSWEG 6';
data.opdrachtgeverPostcode = '3161GL';
data.opdrachtgeverPlaats = 'RHOON';
data.opdrachtgeverTelefoon = '010-1234567'; // optioneel
data.opdrachtgeverEmail = 'TRANSPORT@JORDEX.COM';
data.opdrachtgeverBTW = 'NL815340011B01';
data.opdrachtgeverKVK = '39012345';

 console.log('📌 Klantgegevens geladen:', {
  naam: data.opdrachtgeverNaam,
  adres: data.opdrachtgeverAdres,
  plaats: data.opdrachtgeverPlaats
});

  if (!data.laadplaats && data.klantplaats && data.klantplaats !== '0') {
  data.laadplaats = data.klantplaats;
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
  naam: data.klantBedrijf || '',
  adres: data.klantAdres || '',
  postcode: data.klantPostcode || '',
  plaats: data.klantPlaats || '',
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
console.log('✅ Eindwaarde opdrachtgever:', data.opdrachtgeverNaam);
console.log('📤 DATA OBJECT UIT PARSEJORDEX:', JSON.stringify(data, null, 2));


if (!data.ritnummer || data.ritnummer === '0') {
  console.warn('❗️ Geen ritnummer gevonden – opdracht kan niet gegenereerd worden');
}

  return data;
}
