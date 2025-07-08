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



function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}

function formatDatum(text) {
  const match = text.match(/Date[:\t ]+(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!match) return '0';
  const [_, day, monthStr, year] = match;
  const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  return `${parseInt(day)}-${months[monthStr.toLowerCase().slice(0, 3)]}-${year}`;
}




export default async function parseJordex(pdfBuffer, klantAlias = 'jordex') {
  console.log('📦 Ontvangen pdfBuffer:', pdfBuffer?.length, 'bytes');

  // ❌ Voorkom lege of ongeldige input
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('❌ Ongeldige of ontbrekende PDF buffer');
    return {};
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }

  // 📖 PDF uitlezen en opsplitsen
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(l => l.trim()).filter(Boolean);
  const ritnummerMatch = text.match(/\b(O[EI]\d{7})\b/i);
  
  // 🔍 Multi-pattern extractor: zoekt de eerste waarde die matcht op een van de patronen
  const multiExtract = (patterns) => {
    for (const pattern of patterns) {
      const found = regels.find(line => pattern.test(line));
      if (found) {
        const match = found.match(pattern);
        if (match?.[1]) {
          const result = match[1].trim();
          console.log(`🔎 Pattern match: ${pattern} ➜ ${result}`);
          return result;
        }
      }
    }
    return '';
  };
const fromMatch = text.match(/From:\s*(.*)/);
const klantPlaatsFrom = fromMatch ? fromMatch[1].split(',')[0].trim() : '';

   const data = {
    ritnummer: logResult('ritnummer', ritnummerMatch?.[1] || '0'),
    referentie: logResult('referentie', (() => {
      const m = text.match(/Pick[-\s]?up terminal:[\s\S]+?Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
      return m?.[1]?.trim() || '0';
    })()),
    laadreferentie: logResult('laadreferentie', (() => {
      const blok = text.match(/Pick[-\s]?up:[\s\S]+?Drop[-\s]?off:/i);
      if (blok) {
        const m = blok[0].match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
        return m?.[1]?.trim() || '0';
      }
      return '0';
    })()),
    inleverreferentie: logResult('inleverreferentie', (() => {
      const m = text.match(/Drop[-\s]?off terminal:[\s\S]+?Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
      return m?.[1]?.trim() || '0';
    })()),
    rederij: logResult('rederij', multiExtract([/Carrier[:\t ]+(.+)/i])),
    bootnaam: logResult('bootnaam', multiExtract([/Vessel[:\t ]+(.+)/i])),
    containertype: logResult('containertype', multiExtract([/Cargo[:\t]+(.+)/i]) || '0'),
    containernummer: logResult('containernummer', (() => {
      const result = multiExtract([
        /Container no[:\t ]+([A-Z]{4}U\d{7})/i,
        /([A-Z]{4}U\d{7})/i
      ]);
      return /^[A-Z]{4}U\d{7}$/.test(result || '') ? result : '';
    })()),
    temperatuur: logResult('temperatuur', multiExtract([/Temperature[:\t ]+([\-\d]+°C)/i]) || '0'),

    datum: logResult('datum', formatDatum(text)),

    tijd: logResult('tijd', (() => {
      const m = text.match(/Date[:\t ].+\s+(\d{2}:\d{2})/i);
      return m ? `${m[1]}:00` : '';
    })()),
    inleverBootnaam: logResult('inleverBootnaam', multiExtract([/Vessel[:\t ]+(.+)/i])),
    inleverRederij: logResult('inleverRederij', multiExtract([/Carrier[:\t ]+(.+)/i])),
    inleverBestemming: logResult('inleverBestemming', multiExtract([
  /Final destination[:\t ]+(.+)/i,
  /Arrival[:\t ]+(.+)/i
])),



// Terminalextractie: naam komt meestal onder “Address:” in de sectie
pickupTerminal: logResult('pickupTerminal', (() => {
  const sec = text.match(/Pick[-\s]?up terminal([\s\S]+?)(?:Pick[-\s]?up\b|$)/i)?.[1] || '';
  return sec.match(/Address:\s*(.+)/i)?.[1].trim() || '';
})()),
dropoffTerminal: logResult('dropoffTerminal', (() => {
  const sec = text.match(/Drop[-\s]?off terminal([\s\S]+?)(?:Pick[-\s]?up\b|$)/i)?.[1] || '';
  return sec.match(/Address:\s*(.+)/i)?.[1].trim() || '';
})()),


    gewicht: logResult('gewicht', multiExtract([/Weight[:\t ]+(\d+\s?kg)/i]) || '0'),
    volume: logResult('volume', multiExtract([/Volume[:\t ]+(\d+(?:\.\d+)?\s?m3)/i]) || '0'),
    colli: logResult('colli', multiExtract([/Colli[:\t ]+(\d+)/i]) || '0'),
    lading: logResult('lading', multiExtract([/Description of goods[:\t ]+(.+)/i]) || '0'),
    imo: logResult('imo', multiExtract([/IMO[:\t ]+(\d+)/i]) || '0'),
    unnr: logResult('unnr', multiExtract([/UN[:\t ]+(\d+)/i]) || '0'),
    brix: logResult('brix', multiExtract([/Brix[:\t ]+(\d+)/i]) || '0'),

    opdrachtgeverNaam: 'JORDEX FORWARDING',
    opdrachtgeverAdres: 'AMBACHTSWEG 6',
    opdrachtgeverPostcode: '3161GL',
    opdrachtgeverPlaats: 'RHOON',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'TRANSPORT@JORDEX.COM',
    opdrachtgeverBTW: 'NL815340011B01',
    opdrachtgeverKVK: '39012345',

    terminal: '0',
    rederijCode: '0',
    containertypeCode: '0'
  };

  
const rawPu = data.pickupTerminal || '';
const rawDo = data.dropoffTerminal || '';

// Verwijder “terminal” suffix
const puKey = rawPu.replace(/ terminal$/i, '').trim();
const doKey = rawDo.replace(/ terminal$/i, '').trim();

const pickupInfo  = await getTerminalInfo(puKey)  || {};
const dropoffInfo = await getTerminalInfo(doKey) || {};

// Klantgegevens uit de Pick-up sectie: vier regels erna
const puIndex = regels.findIndex(line => /^Pick[-\s]?up\b/i.test(line));
const klantregels = puIndex >= 0
  ? regels.slice(puIndex + 1, puIndex + 5)
  : [];

data.klantnaam     = klantregels[0] || '';
data.klantadres    = klantregels[1] || '';
data.klantpostcode = klantregels[2] || '';
data.klantplaats   = klantregels[3] || '';
console.log('🔍 Klantgegevens uit Pick-up blok:', klantregels);



// 🧾 Debug loggen voor controle
console.log('🔍 Klantgegevens uit Pick-up blok:');
console.log('👉 naam:', data.klantnaam);
console.log('👉 adres:', data.klantadres);
console.log('👉 postcode:', data.klantpostcode);
console.log('👉 plaats:', data.klantplaats);

  // 🧪 Bepaal laden of lossen
data.isLossenOpdracht = !!data.containernummer && data.containernummer !== '0';
if (!data.isLossenOpdracht) {
  const from = multiExtract([/From[:\t ]+(.+)/i]) || '';
  const to = multiExtract([/To[:\t ]+(.+)/i]) || '';
  if (from.toLowerCase().includes('rotterdam') || from.toLowerCase().includes('nl')) {
    data.isLossenOpdracht = false;
  } else if (to.toLowerCase().includes('rotterdam') || to.toLowerCase().includes('nl')) {
    data.isLossenOpdracht = true;
  }
}

data.ladenOfLossen = data.isLossenOpdracht ? 'Lossen' : 'Laden';

// 🧪 ADR evaluatie op basis van IMO en UNNR
if (data.imo !== '0' || data.unnr !== '0') {
  data.adr = 'Waar';
} else {
  data.adr = 'Onwaar';
  delete data.imo;
  delete data.unnr;
  delete data.brix;
}
  try {
    
    const pickupInfo = await getTerminalInfo(data.pickupTerminal) || {};
    const dropoffInfo = await getTerminalInfo(data.dropoffTerminal) || {};
    data.terminal = await getTerminalInfo(data.dropoffTerminal) || '0';
    data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';
    const baseRederij = data.rederij.includes(' - ') ? data.rederij.split(' - ')[1] : data.rederij;
    data.rederijCode = await getRederijNaam(baseRederij) || '0';

    const formatVoorgemeld = (value) => !value ? 'Onwaar' : (value.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar');

    
// 🔁 Locatiestructuur definitief en correct
data.locaties = [
  {
    volgorde: '0',    
    actie: 'Opzetten',
    naam: rawPu,
    adres: pickupInfo.adres    || '',
    postcode: pickupInfo.postcode || '',
    plaats: pickupInfo.plaats  || '',
    land: pickupInfo.land || 'NL',
    voorgemeld: pickupInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
    aankomst_verw: '',
    tijslot_van: '',
    tijslot_tm: '',
    portbase_code: pickupInfo.portbase_code || '',
    bicsCode: pickupInfo.bicsCode || ''
  },
  {
    volgorde: '0',
    actie: data.isLossenOpdracht ? 'Lossen' : 'Laden',
    naam: data.klantnaam || '',
    adres: data.klantadres || '',
    postcode: data.klantpostcode || '',
    plaats: data.klantplaats || '',
    land: 'NL'
    // geen andere velden hier
  },
  {
    volgorde: '0',
     actie: 'Afzetten',
    naam: rawDo,
    adres: dropoffInfo.adres     || '',
    postcode: dropoffInfo.postcode  || '',
    plaats: dropoffInfo.plaats   || '',
    land: dropoffInfo.land || 'NL',
    voorgemeld: dropoffInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
    aankomst_verw: '',
    tijslot_van: '',
    tijslot_tm: '',
    portbase_code: dropoffInfo.portbase_code || '',
    bicsCode: dropoffInfo.bicsCode || ''
  }
];

  } catch (e) {
    console.warn('⚠️ Fout in terminal of rederij lookup:', e);
  }

  if (!data.referentie || data.referentie === '0') {
    console.warn('⚠️ Referentie (terminal) ontbreekt – wordt leeg gelaten in XML');
  }

if ((!data.ritnummer || data.ritnummer === '0') && parsed.info?.Title?.includes('OE')) {
  const match = parsed.info.Title.match(/(O[EI]\d{7})/i);
  if (match) {
    data.ritnummer = match[1];
  }
}

  console.log('📍 Volledige locatiestructuur gegenereerd:', data.locaties);
  console.log('✅ Eindwaarde opdrachtgever:', data.opdrachtgeverNaam);
  console.log('📤 DATA OBJECT UIT PARSEJORDEX:', JSON.stringify(data, null, 2));
  console.log('📤 PARSE RESULTAAT:', JSON.stringify(data, null, 2));
  console.log('📤 DATA:', JSON.stringify(data, null, 2));
  console.log('🔍 Klantgegevens uit Pick-up blok:', klantregels);
  console.log('🔍 Pick-up index (puIndex):', puIndex);
  console.log('📌 klantplaats fallback:', klantPlaatsFrom);
  console.log('📦 LOCATIES:');
  console.log('👉 Locatie 0 (pickup terminal):', JSON.stringify(data.locaties[0], null, 2));
  console.log('👉 Locatie 1 (klant):', JSON.stringify(data.locaties[1], null, 2));
  console.log('👉 Locatie 2 (dropoff terminal):', JSON.stringify(data.locaties[2], null, 2));
  return data;
}
