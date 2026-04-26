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
  // ✅ 100% correcte extractie uit alleen het "Pick-up" blok (klant)
    const pickupBlokMatch = text.match(/Pick-up\s*\n([\s\S]+?)(?=\n(?:Drop-off terminal|Pick-up terminal|Extra Information|$))/i);
    const pickupBlok = pickupBlokMatch?.[1] || '';
    const pickupRegels = pickupBlok.split('\n').map(r => r.trim()).filter(Boolean);

  // 👤 Klantgegevens – postcode als anker zodat meerregelige bedrijfsnamen correct worden samengevoegd
  const adresLineIdx = pickupRegels.findIndex(r => r.startsWith('Address:'));
  const postcodeIdx  = pickupRegels.findIndex(r => /^\d{4}\s*[A-Z]{2}\b/i.test(r));
  let klantNaam = '', adres = '', postcode = '', plaats = '';
  if (adresLineIdx >= 0 && postcodeIdx > adresLineIdx) {
    const straatIdx = postcodeIdx - 1;
    const naamSlice = pickupRegels.slice(adresLineIdx, straatIdx > adresLineIdx ? straatIdx : adresLineIdx + 1);
    klantNaam  = naamSlice.map((r, i) => i === 0 ? r.replace(/^Address:/i, '').trim() : r.trim()).join(' ').trim();
    adres      = straatIdx > adresLineIdx ? (pickupRegels[straatIdx] || '') : '';
    postcode   = pickupRegels[postcodeIdx] || '';
    plaats     = pickupRegels[postcodeIdx + 1] || '';
  } else if (adresLineIdx >= 0) {
    klantNaam  = pickupRegels[adresLineIdx].replace(/^Address:/i, '').trim();
    adres      = pickupRegels[adresLineIdx + 1] || '';
    postcode   = pickupRegels[adresLineIdx + 2] || '';
    plaats     = pickupRegels[adresLineIdx + 3] || '';
  }

  // 📦 Containerinformatie (eerste Cargo-regel als fallback)
    const cargoLine = pickupRegels.find(r => r.toLowerCase().startsWith('cargo:')) || '';
    const containertype = cargoLine.match(/\d+\s*x\s*(.+)/i)?.[1]?.trim() || '';

  // 📦 Containerwaarden + lading uit de data-regel (kolommen: Type|Number|Seal|Colli|Volume|Weight|Description)
  // Zoek eerst in pickupRegels (Format A: reefer-tabel), daarna in volledige tekst (Format C: algemene cargo-tabel)
  const containerDataLines = pickupRegels.filter(r => /\d+\s*m³.*\d+\s*kg/i.test(r));
  console.log(`📦 ${containerDataLines.length} containerregel(s) gevonden:`, containerDataLines);

  let volume = '0', gewicht = '0', lading = '';

  if (containerDataLines.length > 0) {
    // Format A: volume+gewicht op één regel in pickupBlok
    const dl = containerDataLines[0];
    const vRaw = dl.match(/([\d.,]+)\s*m³/i)?.[1] || '0';
    volume = String(parseInt(vRaw, 10) || 0);
    const gRaw = (dl.match(/([\d.,]+)\s*kg/i)?.[1] || '0').replace(',', '.');
    gewicht = gRaw.includes('.') ? Math.round(parseFloat(gRaw)).toString() : gRaw;
    lading  = dl.match(/\d+\s*kg\s*(.+)/i)?.[1]?.trim() || '';
  } else {
    // Format C: cargo-tabel BUITEN pickupBlok (header: "Type … Number … Seal … Weight …")
    const tabelHdrIdx = regels.findIndex(l => /Type\s.*Number.*Seal.*Weight/i.test(l));
    if (tabelHdrIdx >= 0) {
      // Zoek kg en m³ in de eerste ~8 regels ná de header (pdf-parse kan kolommen splitsen)
      const scanLines = regels.slice(tabelHdrIdx + 1, tabelHdrIdx + 9);
      for (const sl of scanLines) {
        if (/([\d.,]+)\s*m³/i.test(sl) && volume === '0') {
          const vRaw = sl.match(/([\d.,]+)\s*m³/i)?.[1] || '0';
          volume = String(parseInt(vRaw, 10) || 0);
        }
        if (/([\d.,]+)\s*kg/i.test(sl) && gewicht === '0') {
          const gRaw = (sl.match(/([\d.,]+)\s*kg/i)?.[1] || '0').replace(',', '.');
          gewicht = gRaw.includes('.') ? Math.round(parseFloat(gRaw)).toString() : gRaw;
        }
      }

      // Omschrijvings- en GROSS WEIGHT regels achter de datatabel
      const descLines = [];
      for (let i = tabelHdrIdx + 1; i < Math.min(tabelHdrIdx + 25, regels.length); i++) {
        const dl = regels[i];
        if (!dl || /^(Pick|Drop|Extra\s+Info|Date:|Ref)/i.test(dl)) break;
        // GROSS WEIGHT override voor exacte brutogewicht
        const gwm = dl.match(/GROSS\s+WEIGHT\s*[:\s]+(\d[\d.,]*)\s*KG/i);
        if (gwm) { gewicht = String(Math.round(parseFloat(gwm[1].replace(',', '.')))); continue; }
        // Skip technische logistieke velden
        if (/\b(NET WEIGHT|FREIGHT|SHIPPED|PREPAID|FULL NAME|ADDRESS|TEL NO|AGENT|m³|^\d+kg$)\b/i.test(dl)) continue;
        // Skip losse getallen die geen beschrijving zijn
        if (/^\d+([.,]\d+)?\s*(kg|m³)?$/i.test(dl)) continue;
        if (dl.length > 3) descLines.push(dl);
      }
      lading = descLines
        .slice(0, 2)
        .join(' ')
        .replace(/^LOADED\s+WITH\s+/i, '')
        .trim();
    }
  }
  const colli = '0';
  
  // 📅 Datum & tijd — zoek in pickupRegels, anders in de volledige regels
  const dateLine = pickupRegels.find(r => /^Date[:\t ]/i.test(r))
    || regels.find(r => /^Date[:\t ]/i.test(r))
    || '';
  const maanden = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  // Formaat 1: "Date: 21 Apr 2026 08:00"
  const dateMatchText = dateLine.match(/Date[:\t]\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
  // Formaat 2: "Date: 21/04/2026" of "Date: 21-04-2026"
  const dateMatchNum  = dateLine.match(/Date[:\t]\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{2}:\d{2}))?/i);

  let laadDatum = '';
  let laadTijd = '';
  let bijzonderheid = '';

  if (dateMatchText) {
    const dag = parseInt(dateMatchText[1]);
    const maandStr = dateMatchText[2].toLowerCase().slice(0, 3);
    const jaar = dateMatchText[3];
    const tijd = dateMatchText[4];
    const maand = maanden[maandStr];
    laadDatum = `${dag}-${maand}-${jaar}`;
    laadTijd = tijd ? `${tijd}:00` : '';
  } else if (dateMatchNum) {
    laadDatum = `${parseInt(dateMatchNum[1])}-${parseInt(dateMatchNum[2])}-${dateMatchNum[3]}`;
    laadTijd = dateMatchNum[4] ? `${dateMatchNum[4]}:00` : '';
  } else {
    const nu = new Date();
    laadDatum = `${nu.getDate()}-${nu.getMonth() + 1}-${nu.getFullYear()}`;
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

const data = {
    ritnummer: logResult('ritnummer', ritnummerMatch?.[1] || '0'),
    referentie: logResult('referentie', (() => {
    const blok = text.match(/Pick[-\s]?up terminal[\s\S]+?(?=Pick[-\s]?up|Drop[-\s]?off|Extra Information)/i)?.[0] || '';
    const match = blok.match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || laadreferentie || '0';
      })()),
    colli: logResult('colli', colli),
    volume: logResult('volume', volume),
    gewicht: logResult('gewicht', gewicht),
    lading: logResult('lading', lading),
    

    inleverreferentie: logResult('inleverreferentie', (() => {
      const sectie = text.match(/Drop[-\s]?off terminal([\s\S]+?)(?=Pick[-\s]?up terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Reference\(s\):\s*(.+)/i)?.[1]?.trim() || '0';
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
      inleverBestemming: logResult('inleverBestemming', (() => {
        const raw = multiExtract([/Final destination[:\t ]+(.+)/i, /Arrival[:\t ]+(.+)/i]);
        // Strip leading date like "12 Jun 2026 " from arrival lines
        return raw?.replace(/^\d{1,2}\s+\w+\s+\d{4}\s+/i, '').trim() || '';
      })()),

// Terminalextractie: werkelijke naam staat onder “Address:” in de sectie
   pickupTerminal: logResult('pickupTerminal', (() => {
      const sectie = text.match(/Pick[-\s]?up terminal([\s\S]+?)(?=Drop[-\s]?off terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Address:\s*(.+)/i)?.[1].trim() || '';
      })()),
  dropoffTerminal: logResult('dropoffTerminal', (() => {
      const sectie = text.match(/Drop[-\s]?off terminal([\s\S]+?)(?=Pick[-\s]?up terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Address:\s*(.+)/i)?.[1].trim() || '';
      })()),
    imo: logResult('imo', multiExtract([/IMO[:\t ]+(\d+)/i]) || '0'),
    unnr: logResult('unnr', multiExtract([/\bUN[:\t ]+(\d{4})\b/i]) || '0'),
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
// Terminalnamen uit eerste regel na de sectiekop (geen "Address:" prefix in terminalsecties)
const puIndex = regels.findIndex(line => /^Pick[-\s]?up terminal$/i.test(line));
const doIndex = regels.findIndex(line => /^Drop[-\s]?off terminal$/i.test(line));
const puKey = (regels[puIndex + 1] || '').replace(/^Address:\s*/i, '').trim();
const doKey = (regels[doIndex + 1] || '').replace(/^Address:\s*/i, '').trim();
  console.log('🔑 puKey terminal lookup:', puKey);
  console.log('🔑 doKey terminal lookup:', doKey);

// Extraheer raw terminal data uit PDF — gebruik puKey als naam, volgende regels als adres/pc
// Geen l2IsName concatenatie: straatadres zoals "Bunschotenweg 21" begint ook met een letter
const puAdresCandidate  = puIndex >= 0 ? regels[puIndex + 2] || '' : '';
const puPcCandidate     = puIndex >= 0 ? regels[puIndex + 3] || '' : '';
let puNaamRaw  = puKey || '';
let puAdresRaw = '', puPCRaw = '', puPlaatsRaw = '';
if (/[A-Za-z].*\d/.test(puAdresCandidate) || /^\d+\b/.test(puAdresCandidate)) {
  // Ziet eruit als een straatadres ("Bunschotenweg 21" of "21 Bunschotenweg")
  puAdresRaw = puAdresCandidate;
  const pcM = puPcCandidate.match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
  if (pcM) { puPCRaw = `${pcM[1]} ${pcM[2]}`; puPlaatsRaw = pcM[3].trim(); }
} else if (/^(\d{4})\s*[A-Z]{2}\b/.test(puAdresCandidate)) {
  // Geen adresregel, meteen postcode
  const pcM = puAdresCandidate.match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
  if (pcM) { puPCRaw = `${pcM[1]} ${pcM[2]}`; puPlaatsRaw = pcM[3].trim(); }
}

const doAdresCandidate  = doIndex >= 0 ? regels[doIndex + 2] || '' : '';
const doPcCandidate     = doIndex >= 0 ? regels[doIndex + 3] || '' : '';
let doNaamRaw  = doKey || '';
let doAdresRaw = '', doPCRaw = '', doPlaatsRaw = '';
if (/[A-Za-z].*\d/.test(doAdresCandidate) || /^\d+\b/.test(doAdresCandidate)) {
  doAdresRaw = doAdresCandidate;
  const pcM = doPcCandidate.match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
  if (pcM) { doPCRaw = `${pcM[1]} ${pcM[2]}`; doPlaatsRaw = pcM[3].trim(); }
} else if (/^(\d{4})\s*[A-Z]{2}\b/.test(doAdresCandidate)) {
  const pcM = doAdresCandidate.match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
  if (pcM) { doPCRaw = `${pcM[1]} ${pcM[2]}`; doPlaatsRaw = pcM[3].trim(); }
}

// 🧠 Terminal lookup mét rawData voor fuzzy match + auto-create
  let pickupInfo = await getTerminalInfoMetFallback(puKey, { naam: puNaamRaw, adres: puAdresRaw, postcode: puPCRaw, plaats: puPlaatsRaw });
  let dropoffInfo = await getTerminalInfoMetFallback(doKey, { naam: doNaamRaw, adres: doAdresRaw, postcode: doPCRaw, plaats: doPlaatsRaw });

// Klantgegevens uit de Pick-up sectie: vier regels erna
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
    naam: pickupInfo?.naam     || puNaamRaw  || '',
    adres: pickupInfo?.adres   || puAdresRaw || '',
    postcode: pickupInfo?.postcode || puPCRaw || '',
    plaats: pickupInfo?.plaats || puPlaatsRaw || '',
    land: pickupInfo?.land || 'NL',
    voorgemeld: pickupInfo?.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
    aankomst_verw: '',
    tijslot_van: '',
    tijslot_tm: '',
    portbase_code: pickupInfo?.portbase_code || '',
    bicsCode: pickupInfo?.bicsCode || ''
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
    naam:     dropoffInfo?.naam     || doNaamRaw  || '',
    adres:    dropoffInfo?.adres    || doAdresRaw || '',
    postcode: dropoffInfo?.postcode || doPCRaw    || '',
    plaats:   dropoffInfo?.plaats   || doPlaatsRaw || '',
    land: dropoffInfo?.land || 'NL',
    voorgemeld: dropoffInfo?.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
    aankomst_verw: '',
    tijslot_van: '',
    tijslot_tm: '',
    portbase_code: dropoffInfo?.portbase_code || '',
    bicsCode: dropoffInfo?.bicsCode || ''
  }
];

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
  console.log('🧪 DROP-OFF terminal:', dropoffInfo);
  console.log('🧪 PICK-UP terminal:', pickupInfo);

  // 📦 Per container een apart resultaat object
  const parseContainerRegel = async (line, index) => {
    const vRaw = line.match(/([\d.,]+)\s*m³/i)?.[1] || '0';
    const vol = String(parseInt(vRaw, 10) || 0);
    const gRaw = line.match(/([\d.,]+)\s*kg/i)?.[1]?.replace(',', '.') || '0';
    const gew = gRaw.includes('.') ? Math.round(parseFloat(gRaw)).toString() : gRaw;
    const lad = line.match(/\d+\s*kg\s*(.+)/i)?.[1]?.trim() || '';
    // Containertype = alles vóór de eerste aaneengesloten cijferreeks die eindigt op m³
    const ctType = line.replace(/\d+\s*m³.*$/i, '').replace(/\d+$/, '').trim() || data.containertype;
    const ctCode = await getContainerTypeCode(ctType) || '0';
    console.log(`📦 Container ${index + 1}: type=${ctType}, volume=${vol}, gewicht=${gew}, lading=${lad}, code=${ctCode}`);
    return {
      ...data,
      volume: vol,
      gewicht: gew,
      lading: lad,
      colli: '0',
      containertype: ctType,
      containertypeCode: ctCode
    };
  };

  // Format A: reefer tabelrijen met m³ + kg
  if (containerDataLines.length > 0) {
    const results = await Promise.all(containerDataLines.map(parseContainerRegel));
    console.log(`✅ ${results.length} container(s) geparsed (Format A: tabelrijen)`);
    return results;
  }

  // Format B: meerdere Cargo:-blokken (droge containers / gevaarlijke goederen)
  const cargoIndices = pickupRegels.reduce((acc, r, i) => {
    if (/^cargo:/i.test(r)) acc.push(i);
    return acc;
  }, []);

  if (cargoIndices.length > 1) {
    const maandenB = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    const results = await Promise.all(cargoIndices.map(async (startIdx, i) => {
      const endIdx = cargoIndices[i + 1] || pickupRegels.length;
      const blok = pickupRegels.slice(startIdx, endIdx);

      const ctType = blok[0].match(/\d+\s*x\s*(.+)/i)?.[1]?.trim() || data.containertype;
      const ctCode = await getContainerTypeCode(ctType) || '0';

      const dlMatch = blok.find(r => /^Date:/i.test(r))
        ?.match(/Date:\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
      let datum = data.datum;
      let tijd  = data.tijd;
      if (dlMatch) {
        const maand = maandenB[dlMatch[2].toLowerCase().slice(0, 3)];
        datum = `${parseInt(dlMatch[1])}-${maand}-${dlMatch[3]}`;
        tijd  = dlMatch[4] ? `${dlMatch[4]}:00` : '';
      }

      const ref    = blok.find(r => /^Reference/i.test(r))
        ?.match(/Reference(?:\(s\))?[:\t ]+(.+)/i)?.[1]?.trim() || data.laadreferentie;
      const remark = blok.find(r => /^Remark/i.test(r))
        ?.match(/Remark(?:\(s\))?[:\t ]+(.+)/i)?.[1]?.trim() || '';

      console.log(`📦 Container ${i + 1} (Format B): type=${ctType}, datum=${datum}, tijd=${tijd}, ref=${ref}`);
      return {
        ...data,
        containertype: ctType,
        containertypeCode: ctCode,
        datum,
        tijd,
        laadreferentie: ref,
        instructies: remark || data.instructies
      };
    }));
    console.log(`✅ ${results.length} container(s) geparsed (Format B: Cargo-blokken)`);
    return results;
  }

  // Fallback: 1 container met basisdata
  console.warn('⚠️ Geen meerdere containerregels gevonden, basisdata teruggeven');
  return [data];
}
