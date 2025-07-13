// parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { getTerminalInfoMetFallback, getContainerTypeCode } from '../utils/lookups/terminalLookup.js';

pdfjsLib.disableWorker = true;
const { getDocument } = pdfjsLib;


async function extractLines(buffer) {
  // 1) Maak een echte Uint8Array-view over de Buffer
  const uint8 = buffer.buffer !== undefined && buffer.byteOffset !== undefined
  ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  : buffer;

  // 2) Laad de PDF met die Uint8Array
  const pdf = await getDocument({ data: uint8 }).promise;
  const allLines = [];

  // 3) Per pagina: textContent ophalen en groeperen op y/x
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const { items } = await page.getTextContent();

    // Zet elk item om in { text, x, y }
    const runs = items.map(i => ({
      text: i.str,
      x:   i.transform[4],
      y:   i.transform[5]
    }));

    // Groepeer runs op hun y-positie binnen ±2 punten
    const linesMap = [];
    for (const run of runs) {
      let bucket = linesMap.find(l => Math.abs(l.y - run.y) < 2);
      if (!bucket) {
        bucket = { y: run.y, runs: [] };
        linesMap.push(bucket);
      }
      bucket.runs.push(run);
    }

    // Sorteer en join per regel
    const pageLines = linesMap
      .sort((a, b) => b.y - a.y)
      .map(line =>
        line.runs
          .sort((r1, r2) => r1.x - r2.x)
          .map(r => r.text)
          .join(' ')
          .trim()
      );

    allLines.push(...pageLines);
  }

  return allLines;
}


// ─── HELPERS MET DEBUG-LOGS ──────────────────────────────────────────────────
function safeMatch(pattern, text, group = 1, label = '') {
  if (typeof text !== 'string') {
    console.warn(`⚠️ safeMatch ${label}: tekst is geen string:`, text);
    return '';
  }
  const match = text.match(pattern);
  if (!match) {
    console.log(`🔍 safeMatch ${label}: geen match voor ${pattern} in '${text}'`);
    return '';
  }
  const res = (match[group] || '').trim();
  console.log(`✅ safeMatch ${label}: '${res}'`);
  return res;
}

function findFirst(pattern, lines, label = '') {
  for (const line of lines) {
    const m = line.match(pattern);
    if (m && typeof m[1] === 'string') {
      console.log(`✅ findFirst ${label}: '${m[1].trim()}'`);
      return m[1].trim();
    }
  }
  console.log(`🔍 findFirst ${label}: geen match voor ${pattern}`);
  return '';
}

// ─── MAIN PARSER ────────────────────────────────────────────────────────────
export default async function parseDFDS(pdfBuffer, klantAlias = 'dfds') {
  // 1) Basic validation
  if (!pdfBuffer || !(pdfBuffer instanceof Uint8Array || Buffer.isBuffer(pdfBuffer))) {
    console.warn('❌ Ongeldige of ontbrekende PDF buffer');
    return {};
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }

  // 2) PDF → visuele regels
  const splitLines = await extractLines(pdfBuffer);
  console.log(`ℹ️ In totaal ${splitLines.length} regels uit PDF gehaald`);

  // 3) Sections bepalen
  const idxTransportInfo = splitLines.findIndex(r => /^Transport informatie/i.test(r));
  const idxGoederenInfo  = splitLines.findIndex(r => /^Goederen informatie/i.test(r));
  console.log(`ℹ️ Transport-info op regel ${idxTransportInfo}, goederen-info op ${idxGoederenInfo}`);

  const goederenLines = idxGoederenInfo >= 0
  ? splitLines.slice(idxGoederenInfo + 1)
  : [];

  // 4) Transport-informatie
  const transportLines = (idxTransportInfo >= 0 && idxGoederenInfo > idxTransportInfo)
    ? splitLines.slice(idxTransportInfo + 1, idxGoederenInfo)
    : [];

  // 5) Container nr
  const containernummer = findFirst(/([A-Z]{4}\d{7})/, transportLines, 'containernummer');

  // Containertype (origineel)
let containertypeRaw = findFirst(
  new RegExp(`${containernummer}\\s*([0-9]{2,3}(?:ft)?\\s?[A-Za-z]{2,3})`, 'i'),
  transportLines,
  'containertype-via-contnr'
);

if (!containertypeRaw) {
  // fallback: match eender waar “40ft HC”, “20GP” etc.
  containertypeRaw = findFirst(
    /([0-9]{2,3}ft\s?[A-Za-z]{2,3}|20GP|40GP|40HC|45HC|45R1|20DC|40DC|20RF|40RF|45RF|20OT|40OT|20FR|40FR)/i,
    transportLines,
    'containertype-standaard'
  );
}

console.log(`🔍 containertypeRaw: '${containertypeRaw}'`);

  const normalizedContainertype = containertypeRaw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  console.log(`🔍 normalizedContainertype: ‘${normalizedContainertype}’`);

  // Volume: grootste m3
  let volume = '';
  for (const l of transportLines) {
    const m = l.match(/([\d.,]+)\s*m3/i);
    if (m && m[1]) {
      const v = m[1].replace(',', '.');
      if (!volume || parseFloat(v) > parseFloat(volume)) {
        volume = v;
      }
    }
  }
  console.log(`🔍 volume: ‘${volume}’`);

  // Referenties: pickup & lossen
    const pickupReferentie = findFirst(
    /Pickup[:\s]*([A-Za-z0-9]+)/i,
    transportLines,
    'pickup-ref'
    );
    const lossenReferentie = findFirst(
      /Lossen[:\s]*([A-Za-z0-9]+)/i,
      transportLines,
      'lossen-ref'
    );
    console.log(`🔍 pickupReferentie: '${pickupReferentie}', lossenReferentie: '${lossenReferentie}'`);
      
// Datum & Tijd (Lossen)
  let datum = '';
  let tijd = '';
  const anyDateLine = transportLines.find(l => /\d{2}-\d{2}-\d{4}/.test(l));
  if (anyDateLine) {
    datum = safeMatch(/(\d{2}-\d{2}-\d{4})/, anyDateLine, 1, 'datum');
    // tijd kan ook in dezelfde lijn staan: “07:30-15:30” of “07:30 - 15:30”
    tijd = safeMatch(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/, anyDateLine, 0, 'tijd');
    // normaliseren naar “hhmm-hhmm”
    if (tijd) {
      tijd = tijd.replace(/:/g, '').replace(/\s*-\s*/, '-');
    }
  }
  console.log(`🔍 datum: '${datum}', tijd: '${tijd}'`);

  // --- TERMINALS: NAAM + ADRES uit blok vóór Goederen informatie ---
  let pickupTerminal = '', pickupAdres = '';
  let klantNaam = '', klantAdres = '', klantPostcode = '', klantPlaats = '';
  let dropoffTerminal = '', dropoffAdres = '';

  // Vind het eerste pickup/ lossen/ dropoff in transportLines of in de daarop volgende regels tot Goederen-info
  const terminalSection = splitLines.slice(
  idxTransportInfo + 1,
  idxGoederenInfo > 0 ? idxGoederenInfo : splitLines.length
);

  // Indices
  const iPU = terminalSection.findIndex(r => /^Pickup\b/i.test(r));
  const iLO = terminalSection.findIndex(r => /^Lossen\b/i.test(r));
  const iDO = terminalSection.findIndex(r => /^Dropoff\b/i.test(r));

  if (iPU !== -1) {
    pickupTerminal = terminalSection[iPU].replace(/^Pickup\s*/i, '').trim();
    pickupAdres = (terminalSection[iPU + 1] || '').trim();
    console.log(`🔍 pickupTerminal: ‘${pickupTerminal}’, pickupAdres: ‘${pickupAdres}’`);
  }
  if (iLO !== -1) {
    klantNaam = terminalSection[iLO].replace(/^Lossen\s*/i, '').trim();
    klantAdres = (terminalSection[iLO + 1] || '').trim();
    console.log(`🔍 klantNaam (Lossen): ‘${klantNaam}’, klantAdres: ‘${klantAdres}’`);
    // postcode + plaats uit adreslijn
    const pcMatch = klantAdres.match(/(\d{4}\s?[A-Z]{2})\s*([A-Za-z\- ]+)/);
    if (pcMatch) {
      klantPostcode = pcMatch[1].trim();
      klantPlaats = pcMatch[2].trim();
    }
  }
  if (iDO !== -1) {
    dropoffTerminal = terminalSection[iDO].replace(/^Dropoff\s*/i, '').trim();
    dropoffAdres = (terminalSection[iDO + 1] || '').trim();
    console.log(`🔍 dropoffTerminal: ‘${dropoffTerminal}’, dropoffAdres: ‘${dropoffAdres}’`);
  }

 
  let colli = findFirst(/(\d+)\s*(?:carton|colli|pcs)/i, goederenLines, 'colli');
  let lading = findFirst(/(?:\d+\s+(?:carton|colli|pcs)\s+)([A-Za-z0-9\-\s]+)/i, goederenLines, 'lading');
  let gewicht = '';
  for (const l of goederenLines) {
    const m = l.match(/([\d.,]+)\s*kg/i);
    if (m && m[1]) {
      const w = m[1].replace(',', '.');
      if (!gewicht || parseFloat(w) > parseFloat(gewicht)) {
        gewicht = w;
      }
    }
  }
  console.log(`🔍 colli: ‘${colli}’, lading: ‘${lading}’, gewicht: ‘${gewicht}’`);

  // --- CONTAINERTYPE CODE OPVRAGEN ---
  let containertypeCode = '0';
  if (normalizedContainertype) {
    try {
      containertypeCode = await getContainerTypeCode(normalizedContainertype);
      console.log(`📦 containertypeCode: ‘${containertypeCode}’`);
    } catch (e) {
      console.warn('⚠️ Fout bij ophalen containertypeCode:', e);
    }
  }

  // --- OPBOUW DATA OBJECT ---
  const data = {
    container_nr: containernummer,
    containertype: containertypeRaw,
    containertype_code: containertypeCode,
    volume: volume,
    pickup_referentie: pickupReferentie,
    lossen_referentie: lossenReferentie,
    datum: datum,
    tijd: tijd,
    pickup_terminal: pickupTerminal,
    pickup_adres: pickupAdres,
    klant_naam: klantNaam,
    klant_adres: klantAdres,
    klant_postcode: klantPostcode,
    klant_plaats: klantPlaats,
    dropoff_terminal: dropoffTerminal,
    dropoff_adres: dropoffAdres,
    colli: colli,
    lading: lading,
    gewicht: gewicht
  };
 // 5) Default opdrachtgever‐velden
  data.opdrachtgeverNaam     = 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.';
  data.opdrachtgeverAdres    = 'WOLGAWEG 3';
  data.opdrachtgeverPostcode = '3198 LR';
  data.opdrachtgeverPlaats   = 'ROTTERDAM';
  data.opdrachtgeverTelefoon = '010-1234567';                     // óók aanpassen als je wilt
  data.opdrachtgeverEmail    = 'nl-rtm-operations@dfds.com';
  data.opdrachtgeverBTW      = 'NL007129099B01';
  data.opdrachtgeverKVK      = '24232781';

  // 6) Terminal‐lookups (met fallback) voor je locaties
  const pickupInfo  = await getTerminalInfoMetFallback(pickupTerminal)  || {};
  const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal) || {};

  // 7) Bouw de locaties‐array á la je oude full‐versie
  data.locaties = [
    {
      volgorde: '0',
      actie: 'Opzetten',
      naam:      pickupInfo.naam  || pickupTerminal,  
      adres:     pickupInfo.adres || pickupAdres,
      postcode:  pickupInfo.postcode|| '',
      plaats:    pickupInfo.plaats|| '',
      land:      pickupInfo.land  || 'NL',
      portbase_code: pickupInfo.portbase_code || '',
      bicsCode:      pickupInfo.bicsCode      || ''
    },
    {
      volgorde: '1',
      actie: 'Lossen',
      naam:     klantNaam || '',
      adres:    klantAdres|| '',
      postcode: klantPostcode || '',
      plaats:   klantPlaats   || '',
      land:     'NL'
    },
    {
      volgorde: '2',
      actie: 'Afzetten',
      naam:      dropoffInfo.naam  || dropoffTerminal,  
      adres:     dropoffInfo.adres || dropoffAdres,
      postcode:  dropoffInfo.postcode|| '',
      plaats:    dropoffInfo.plaats|| '',
      land:      dropoffInfo.land  || 'NL',
      portbase_code: dropoffInfo.portbase_code || '',
      bicsCode:      dropoffInfo.bicsCode      || ''
    }
  ];
  // ————————————————————————

  console.log('📍 locaties:', JSON.stringify(data.locaties, null, 2));
  console.log('✅ Eindresultaat data object met opdrachtgever en locaties:', JSON.stringify(data, null, 2));
  return data;
}
