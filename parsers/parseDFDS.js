// parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfo,
  getRederijNaam,
  getContainerTypeCode,
  getTerminalInfoFallback,
  getTerminalInfoMetFallback
} from '../utils/lookups/terminalLookup.js';



function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}

function formatDatum(text) {
  const match = text.match(/Date[:\t ]+(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!match) return '';
  const [_, day, monthStr, year] = match;
  const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  const maand = months[monthStr.toLowerCase().slice(0, 3)];
  return `${parseInt(day)}-${maand}-${year}`;
}


export default async function parseDFDS(pdfBuffer, klantAlias = 'DFDS') {
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
  const ritnummerMatch = text.match(/Onze referentie[:\s]+(SFIM\d{7})/i)
  
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

// 📦 Containers uitlezen uit "Transport informatie" blok
const containers = [];
const lines = regels;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Herken containerregel
  const containerMatch = line.match(/^([A-Z]{4}\d{7})\s+(.+?)\s+Pickup\s+(\S+)\s+(\d{2}-\d{2}-\d{4})$/i);
  if (containerMatch) {
    const [
      _,
      containernummer,
      typeInfo,
      pickupRef,
      datum
    ] = containerMatch;

    // Zoek volgende regel voor lossen en tijd
    const volgende = lines[i + 1] || '';
    const lossMatch = volgende.match(/^Lossen\s+(\S+)\s+(\d{2}-\d{2}-\d{4})\s+(\d{2}:\d{2})\s+-\s+(\d{2}:\d{2})/i);
    const losreferentie = lossMatch?.[1] || '';
    const tijdVan = lossMatch?.[3] ? `${lossMatch[3]}:00` : '';
    const tijdTot = lossMatch?.[4] ? `${lossMatch[4]}:00` : '';

    // Zoek zegelregel
    const zegelRegel = lines.find(r => r.includes(containernummer) && r.includes('Zegel:'));
    const zegelMatch = zegelRegel?.match(/Zegel:\s*(\S+)/i);
    const zegelnummer = zegelMatch?.[1] || '';

    // Zoek lading en gewicht
    const ladingregel = lines.find(r => r.startsWith(containernummer));
    const inhoudregel = lines.find(r => r.includes('CARTON') || r.match(/\d+\s+[A-Z]/));

    const gewichtMatch = inhoudregel?.match(/([\d.,]+)\s*kg/i);
    const colliMatch = inhoudregel?.match(/^(\d{1,5})\s+/);
    const volumeMatch = typeInfo?.match(/[-–]\s*([\d.,]+)\s*m3/i);
    const lading = inhoudregel?.replace(/^\d{1,5}\s+\w+\s+/i, '').replace(/\s*[\d.,]+\s*kg.*$/i, '').trim() || '';

    containers.push({
      containernummer,
      containertype: typeInfo.split('-')[0].trim(), // e.g. "40ft HC"
      zegelnummer,
      volume: volumeMatch?.[1]?.replace(',', '.') || '0',
      datum,
      tijd: tijdVan,
      tijdTm: tijdTot,
      laadreferentie: pickupRef,
      inleverreferentie: losreferentie,
      gewicht: gewichtMatch?.[1]?.replace(',', '.') || '0',
      colli: colliMatch?.[1] || '0',
      lading
    });
  }
}

const gewichtMatch = inhoudregel?.match(/([\d.,]+)\s*kg/i);
const colliMatch = inhoudregel?.match(/^(\d{1,5})\s+/);
const volumeMatch = typeInfo?.match(/[-–]\s*([\d.,]+)\s*m3/i);

const data = {
    ritnummer: logResult('ritnummer', ritnummerMatch?.[1] || '0'),
    referentie: logResult('referentie', (() => {
    const blok = text.match(/Pick[-\s]?up terminal[\s\S]+?(?=Pick[-\s]?up|Drop[-\s]?off|Extra Information)/i)?.[0] || '';
    const match = blok.match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || '0';
      })()),
    colli: logResult('colli', colli),
    volume: logResult('volume', volume),
    gewicht: logResult('gewicht', gewicht),
    lading: logResult('lading', lading),
    

    inleverreferentie: logResult('inleverreferentie', (() => {
      const m = text.match(/Drop[-\s]?off terminal:[\s\S]+?Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
      return m?.[1]?.trim() || '0';
      })()),
    rederij: logResult('rederij', multiExtract([/Carrier[:\t ]+(.+)/i])),
    bootnaam: logResult('bootnaam', multiExtract([/Vessel[:\t ]+(.+)/i])),
    containernummer: logResult('containernummer', (() => {
      const result = multiExtract([
        /Container no[:\t ]+([A-Z]{4}U\d{7})/i,
        /([A-Z]{4}U\d{7})/i
      ]);
      return /^[A-Z]{4}U\d{7}$/.test(result || '') ? result : '';
      })()),
    temperatuur: logResult('temperatuur', multiExtract([/Temperature[:\t ]+([\-\d]+°C)/i]) || '0'),
    datum: logResult('datum', laadDatum),
    tijd: logResult('tijd', laadTijd),
    instructies: logResult('instructies', bijzonderheid),
    laadreferentie: logResult('laadreferentie', laadreferentie),
    containertype: logResult('containertype', containertype),
    inleverBootnaam: logResult('inleverBootnaam', multiExtract([/Vessel[:\t ]+(.+)/i])),
    inleverRederij: logResult('inleverRederij', multiExtract([/Carrier[:\t ]+(.+)/i])),
      inleverBestemming: logResult('inleverBestemming', multiExtract([
      /Final destination[:\t ]+(.+)/i,
      /Arrival[:\t ]+(.+)/i
       ])),

// Terminalextractie: werkelijke naam staat onder “Address:” in de sectie
   pickupTerminal: logResult('pickupTerminal', (() => {
      const sectie = text.match(/Pick[-\s]?up terminal([\s\S]+?)(?=Drop[-\s]?off terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Address:\s*(.+)/i)?.[1].trim() || '';
      })()),
  dropoffTerminal: logResult('dropoffTerminal', (() => {
      const sectie = text.match(/Drop[-\s]?off terminal([\s\S]+?)(?=Pick[-\s]?up terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Address:\s*(.+)/i)?.[1].trim() || '';
      })()),
      // 🔍 Inleverreferentie uit Drop-off terminal sectie
    inleverreferentie: logResult('inleverreferentie', (() => {
      const sectie = text.match(/Drop[-\s]?off terminal([\s\S]+?)(?=Pick[-\s]?up terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Reference\(s\):\s*(.+)/i)?.[1]?.trim() || '';
  })()),
      
    colli: logResult('colli', colli),
    volume: logResult('volume', volume),
    lading: logResult('lading', multiExtract([/Description of goods[:\t ]+(.+)/i]) || '0'),
    imo: logResult('imo', multiExtract([/IMO[:\t ]+(\d+)/i]) || '0'),
    unnr: logResult('unnr', multiExtract([/UN[:\t ]+(\d+)/i]) || '0'),
    brix: logResult('brix', multiExtract([/Brix[:\t ]+(\d+)/i]) || '0'),

    opdrachtgeverNaam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
    opdrachtgeverAdres: 'WOLGAWEG 3',
    opdrachtgeverPostcode: '3200AA',
    opdrachtgeverPlaats: 'SPIJKENISSE',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781',

    terminal: '0',
    rederijCode: '0',
    containertypeCode: '0'
  };

// Verwijder “terminal” suffix zodat je sleutel mét en stemt met Supabase
  const pickupTerminalMatch = text.match(/Pick[-\s]?up terminal[\s\S]+?Address:\s*(.+)/i);
  const puKey = pickupTerminalMatch?.[1]?.trim() || '';

// 🎯 Terminaladres extractie
  const dropoffTerminalMatch = text.match(/Drop[-\s]?off terminal[\s\S]+?Address:\s*(.+)/i);
  const dropoffTerminalAdres = dropoffTerminalMatch?.[1]?.trim() || '';
  const doKey = dropoffTerminalAdres || data.dropoffTerminal || '';
    console.log('🔑 doKey terminal lookup:', doKey);

// 🧠 Terminal lookup mét fallback op volledigheid
  let pickupInfo = await getTerminalInfoMetFallback(puKey);
  let dropoffInfo = await getTerminalInfoMetFallback(doKey);

// Klantgegevens uit de Pick-up sectie: vier regels erna
const puIndex = regels.findIndex(line => /^Pick[-\s]?up terminal$/i.test(line));
const klantregels = regels
  .slice(puIndex + 1, puIndex + 8)
  .filter(l => l && !/^Cargo:|^Reference/i.test(l))
  .slice(0, 4);                            
data.klantnaam = klantNaam;
data.klantadres = adres;
data.klantpostcode = postcode;
data.klantplaats = plaats;
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
  data.terminal = await getTerminalInfo(data.dropoffTerminal) || '0';
  data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';

  const baseRederij = data.rederij.includes(' - ')
    ? data.rederij.split(' - ')[1].trim()
    : data.rederij.trim();

  const officiëleRederij = await getRederijNaam(baseRederij);
   console.log('🎯 MATCH uit rederijenlijst:', officiëleRederij);
    if (officiëleRederij && officiëleRederij !== '0') {
    data.rederij = officiëleRederij;
    data.inleverRederij = officiëleRederij;
  }
  
} catch (e) {
  console.warn('⚠️ Fout in terminal of rederij lookup:', e);
}
 

// 🔁 Locatiestructuur definitief en correct
data.locaties = [
  {
    volgorde: '0',    
    actie: 'Opzetten',
    naam: pickupInfo.naam   || puKey,
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
    naam: dropoffInfo.naam || doKey,
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

  if (!data.referentie || data.referentie === '0') {
    console.warn('⚠️ Referentie (terminal) ontbreekt – wordt leeg gelaten in XML');
  }

if ((!data.ritnummer || data.ritnummer === '0') && parsed.info?.Title?.includes('SFIM')) {
  const match = parsed.info.Title.match(/(sfim\d{7})/i);
  if (match) {
    data.ritnummer = match[1];
  }
}

  console.log('📍 Volledige locatiestructuur gegenereerd:', data.locaties);
  console.log('✅ Eindwaarde opdrachtgever:', data.opdrachtgeverNaam);
  console.log('📤 DATA OBJECT UIT PARSEDFDS:', JSON.stringify(data, null, 2));
  console.log('🔍 Klantgegevens uit Pick-up blok:', klantregels);
  console.log('📦 LOCATIES:');
  console.log('👉 Locatie 0 (pickup terminal):', JSON.stringify(data.locaties[0], null, 2));
  console.log('👉 Locatie 1 (klant):', JSON.stringify(data.locaties[1], null, 2));
  console.log('👉 Locatie 2 (dropoff terminal):', JSON.stringify(data.locaties[2], null, 2));
  console.log('🧪 DROP-OFF terminal:', dropoffInfo);
  console.log('🧪 PICK-UP terminal:', pickupInfo);
  return data;
}
