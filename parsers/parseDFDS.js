// parsers/parseJordex.js
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
  const ritnummerMatch = text.match(/Onze referentie[:\s]+(SFIM\d{7})/i);
  
  // 📦 Containerregels extraheren bij DFDS
  const containerRegels = regels.filter(r =>
    /^[A-Z]{4}U\d{7}/.test(r) || /Zegel[:\s]/i.test(r) || /kg/i.test(r) || /m3/i.test(r)
  );
  console.log('📦 Geselecteerde containerregels:', containerRegels);

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
  // ✅ 100% correcte extractie uit alleen het "Pick-up" blok (klant)
    const pickupBlokMatch = text.match(/Pick-up\s*\n([\s\S]+?)(?=\n(?:Drop-off terminal|Pick-up terminal|Extra Information|$))/i);
    const pickupBlok = pickupBlokMatch?.[1] || '';
    const pickupRegels = pickupBlok.split('\n').map(r => r.trim()).filter(Boolean);

  // 👤 Klantgegevens
    const klantNaam = pickupRegels.find(r => r.startsWith('Address:'))?.replace('Address:', '').trim() || '';
    const adresIndex = pickupRegels.findIndex(r => r.includes(klantNaam)) + 1;
    const adres = pickupRegels[adresIndex] || '';
    const postcode = pickupRegels[adresIndex + 1] || '';
    const plaats = pickupRegels[adresIndex + 2] || '';

  // 📅 Datum & tijd
    const dateLine = pickupRegels.find(r => /^Date[:\t ]+/i.test(r)) || '';
    const dateMatch = dateLine.match(/Date:\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
    
    // 📆 Fallback = upload datum
    let laadDatum = '';
    let laadTijd = '';
    let bijzonderheid = '';

if (dateMatch) {
  const dag = parseInt(dateMatch[1]);
  const maandStr = dateMatch[2].toLowerCase().slice(0, 3);
  const jaar = dateMatch[3];
  const tijd = dateMatch[4];

  const maanden = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  const maand = maanden[maandStr];

  laadDatum = `${dag}-${maand}-${jaar}`;
  laadTijd = tijd ? `${tijd}:00` : '';
} else {
  // Fallback: datum van vandaag zonder voorloopnullen
    const nu = new Date();
    laadDatum = `${nu.getDate()}-${nu.getMonth() + 1}-${nu.getFullYear()}`;
  laadTijd = '';
  bijzonderheid = 'DATUM STAAT VERKEERD';
}
  // 🔗 Referentie
    const refLine = pickupRegels.find(r => /Reference/.test(r)) || '';
    const laadreferentie = refLine.match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i)?.[1]?.trim() || '';

    const fromMatch = text.match(/From:\s*(.*)/);
 
        console.log('📅 Extractie uit pickupRegels:', pickupRegels);
        console.log('📅 dateLine:', dateLine);
        console.log('📅 dateMatch:', dateMatch);
        console.log('📅 laadDatum:', laadDatum);
        console.log('📅 laadTijd:', laadTijd);


let containernummer = '', zegelnummer = '', gewicht = '0', volume = '0', colli = '0', referentie = '', lading = '', containertype = '';


for (const regel of containerRegels) {
  // Containernummer
  if (!containernummer) {
    const match = regel.match(/^([A-Z]{4}U\d{7})/);
    if (match) {
      containernummer = match[1];
      console.log('🚛 Containernummer gevonden:', containernummer);
    }
  }

  // Containertype
  if (!containertype) {
    const typeMatch = regel.match(/^[A-Z]{4}U\d{7}\s+([\d\w\s\-]+m3)/i);
    if (typeMatch) {
      containertype = typeMatch[1].trim();
      console.log('📦 Containertype gevonden:', containertype);
    }
  }

  // Zegelnummer
  if (!zegelnummer && regel.toLowerCase().includes('zegel')) {
    const match = regel.match(/Zegel[:\s]+(\d+)/i);
    if (match) {
      zegelnummer = match[1];
      console.log('🔐 Zegelnummer gevonden:', zegelnummer);
    }
  }

  // Gewicht
  if (regel.toLowerCase().includes('kg') && gewicht === '0') {
    const match = regel.match(/([\d.,]+)\s*kg/i);
    if (match) {
      gewicht = match[1].replace(',', '.');
      if (gewicht.includes('.')) {
        gewicht = Math.round(parseFloat(gewicht)).toString();
      }
      console.log('⚖️ Gewicht gevonden:', gewicht);
    }
  }

  // Volume
  if (regel.toLowerCase().includes('m3') && volume === '0') {
    const match = regel.match(/([\d.,]+)\s*m3/i);
    if (match) {
      volume = match[1].replace(',', '.');
      console.log('📏 Volume gevonden:', volume);
    }
  }

  // Colli
  if (regel.match(/^\d{2,5}$/) && colli === '0') {
    colli = regel.trim();
    console.log('📦 Colli gevonden:', colli);
  }

  // Lading + referentie
  if (!referentie || !lading) {
    const refMatch = regel.match(/Lossen.*?(\d{7,})/i);
    if (refMatch) {
      referentie = refMatch[1];
      console.log('📌 Referentie gevonden:', referentie);
    }

    const ladingMatch = regel.match(/^\d+\s+\w+\s+(.*?)\s+[\d.,]+\s*kg/i);
    if (ladingMatch) {
      lading = ladingMatch[1].trim();
      console.log('📦 Lading gevonden:', lading);
    }
  }
}



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
    containernummer: logResult('containernummer', containernummer),
    containertype: logResult('containertype', containertype),
    zegelnummer: logResult('zegelnummer', zegelnummer),
    gewicht: logResult('gewicht', gewicht),
    volume: logResult('volume', volume),
    colli: logResult('colli', colli),
    referentie: logResult('referentie', referentie),
    lading: logResult('lading', lading),

    inleverreferentie: logResult('inleverreferentie', (() => {
      const m = text.match(/Drop[-\s]?off terminal:[\s\S]+?Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
      return m?.[1]?.trim() || '0';
      })()),
    rederij: logResult('rederij', multiExtract([/Carrier[:\t ]+(.+)/i])),
    bootnaam: logResult('bootnaam', multiExtract([/Vessel[:\t ]+(.+)/i])),
    
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

    opdrachtgeverNaam: 'JORDEX FORWARDING',
    opdrachtgeverAdres: 'AMBACHTSWEG 6',
    opdrachtgeverPostcode: '3161GL',
    opdrachtgeverPlaats: 'RHOON',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'TRANSPORT@JORDEX.COM',
    opdrachtgeverBTW: 'NL815340011B01',
    opdrachtgeverKVK: '24390991',

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
  const match = parsed.info.Title.match(/(SFIM\d{7})/i);
  if (match) {
    data.ritnummer = match[1];
  }
}

  console.log('📍 Volledige locatiestructuur gegenereerd:', data.locaties);
  console.log('✅ Eindwaarde opdrachtgever:', data.opdrachtgeverNaam);
  console.log('📤 DATA OBJECT UIT PARSEJORDEX:', JSON.stringify(data, null, 2));
  console.log('🔍 Klantgegevens uit Pick-up blok:', klantregels);
  console.log('📦 LOCATIES:');
  console.log('👉 Locatie 0 (pickup terminal):', JSON.stringify(data.locaties[0], null, 2));
  console.log('👉 Locatie 1 (klant):', JSON.stringify(data.locaties[1], null, 2));
  console.log('👉 Locatie 2 (dropoff terminal):', JSON.stringify(data.locaties[2], null, 2));
  console.log('🧪 DROP-OFF terminal:', dropoffInfo);
  console.log('🧪 PICK-UP terminal:', pickupInfo);
  return data;
}
