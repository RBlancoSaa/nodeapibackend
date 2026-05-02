// parsers/parseB2L.js
import '../utils/fsPatch.js';
import { extractPdfText } from '../utils/ocrPdf.js';
import { normLand } from '../utils/lookups/terminalLookup.js';
import { enrichOrder } from '../utils/enrichOrder.js';

const MONTHS_EN = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function parseDatumNL(str) {
  const m = (str || '').match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (!m) return '';
  return `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}-${m[3]}`;
}

function parseDatumEN(str) {
  // "22-Apr-2026" or "29-APR-2026" or "30-APR-2026"
  const m = (str || '').match(/(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/);
  if (!m) return '';
  const maand = MONTHS_EN[m[2].toLowerCase()];
  if (!maand) return '';
  return `${m[1].padStart(2,'0')}-${String(maand).padStart(2,'0')}-${m[3]}`;
}

function valAfterLabel(line, label) {
  return line?.replace(new RegExp(`.*${label}[:\\s]*`, 'i'), '').trim() || '';
}

// Herkent sectie-headers die we moeten overslaan als naam/adres
const SECTION_LABEL_RE = /^(?:EMPTY|FULL)\s+PICK-?UP\s+TERMINAL|^FULL\s+DELIVERY\s+TERMINAL|^EMPTY\s+(?:RETURN|DELIVERY)\s+TERMINAL|^EMPTY\s+DEPOT|^PLACE\s+OF\s+(?:LOADING|DELIVERY|UNLOADING|DISCHARGE)|^DELIVERY\s+ADDRESS|^DATE\/?TIME|^PORT\s+(?:OF|NUMBER)|^VOYAGE|^CARRIER|^MAIN\s+VESSEL|^ROUTINGS|^FROM\s+/i;

// Geeft de eerste 'echte' bedrijfs/terminalnaam terug na een sectie-index.
// Strips REFERENCE:... van de regel en slaat sectie-headers over.
function nextRealLine(arr, startIdx) {
  for (let i = startIdx; i < arr.length; i++) {
    const raw  = arr[i] || '';
    const line = raw.replace(/REFERENCE[:\s].*/i, '').trim();
    if (line && !SECTION_LABEL_RE.test(line)) return { line, idx: i };
  }
  return { line: '', idx: startIdx };
}

// Adres-kandidaat: als de volgende regel een sectie-header is, geen adres.
function safeAdres(arr, idx) {
  const raw = arr[idx] || '';
  return SECTION_LABEL_RE.test(raw) ? '' : raw;
}

export default async function parseB2L(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { lines: rawLs } = await extractPdfText(buffer, 'B2L transportopdracht');
  // Dedupliceer identieke regels (PDF bevat soms 3× dezelfde paginakoptekst)
  const seen = new Set();
  const ls = rawLs.filter(r => r && !seen.has(r) && seen.add(r));
  console.log('📋 B2L regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // === Referentie / ritnummer ===
  const refIdx   = ls.findIndex(l => /^REFERENTIE$/i.test(l));
  const ritnummer = refIdx >= 0 ? (ls[refIdx + 1] || '') : '';

  // === Container type & count ===
  // PDF kan "CONTAINER SET: 2X 40FT HIGH CUBE" of "CONTAINERS:2X 40FT HIGH CUBE" bevatten
  const containerSetLine = ls.find(l => /CONTAINER\s+SET/i.test(l) || /^CONTAINERS\s*:/i.test(l));
  const countMatch = containerSetLine?.match(/(\d+)\s*[Xx]\s+(.+)/i);
  const containerCount   = parseInt(countMatch?.[1] || '1');
  const containertypeRaw = countMatch?.[2]?.trim() || '40FT HIGH CUBE';
  const containertype    = /high.?cube|HC/i.test(containertypeRaw)
    ? (/40/i.test(containertypeRaw) ? '40ft HC' : '45ft HC')
    : (/40/i.test(containertypeRaw) ? '40ft' : '20ft');

  // === Cargo ===
  const cargoLine  = ls.find(l => /CARGO DESCRIPTION/i.test(l));
  const weightLine = ls.find(l => /ESTIMATED WEIGHT/i.test(l));
  const lading  = valAfterLabel(cargoLine,  'CARGO DESCRIPTION');
  const kgMatch = weightLine?.match(/([\d.,]+)\s*KGS?/i);
  const gewicht = kgMatch ? String(Math.round(parseFloat(kgMatch[1].replace(',', '.')))) : '0';

  // === Container nummer (fallback bij enkelvoudige TO) ===
  // Vierde letter is altijd U (ISO 6346). Accepteer ook "SEGU-6476333" (dash-formaat).
  const CNTR_RE = /^([A-Z]{3}[A-Z])-?(\d{7})$/i;
  const containerNummerPDF = (() => {
    const line = ls.find(l => CNTR_RE.test(l.trim()));
    if (!line) return '';
    const m = line.trim().match(CNTR_RE);
    return m ? (m[1] + m[2]).toUpperCase() : '';
  })();

  // === RIDER-sectie: per-container data (nummer, gewicht, colli) ===
  const riderIdx = ls.findIndex(l => /^RIDER$/i.test(l));
  const riderContainers = [];
  if (riderIdx >= 0) {
    for (let i = riderIdx + 1; i < ls.length; i++) {
      const m = ls[i].trim().match(CNTR_RE);
      if (m) {
        const cntr = (m[1] + m[2]).toUpperCase();
        let riderGewicht = '0', riderColli = '0';
        for (let j = i + 1; j < Math.min(i + 12, ls.length); j++) {
          if (CNTR_RE.test(ls[j].trim())) break;   // volgende container
          const wM = ls[j].match(/([\d.,]+)\s*kgs?/i);
          if (wM) riderGewicht = String(Math.round(parseFloat(wM[1].replace(',', '.'))));
          const cM = ls[j].match(/^(\d+)\s*[xX]\s+/);
          if (cM) riderColli = cM[1];
        }
        riderContainers.push({ containernummer: cntr, gewicht: riderGewicht, colli: riderColli });
      }
    }
  }
  console.log(`📦 B2L RIDER containers: ${riderContainers.length}`, riderContainers.map(c => c.containernummer).join(', '));

  // === DELIVERY SCHEDULE: per-container datum & tijd ===
  // Formaat: "SEGU-647633340ft High Cube-04-May-2026 at 14.00h"
  const deliveryMap = {};
  for (const l of ls) {
    const cntrM = l.match(/([A-Z]{3}[A-Z])-?(\d{7})/i);
    const dateM = l.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/i);
    if (!cntrM || !dateM) continue;
    const cntr = (cntrM[1] + cntrM[2]).toUpperCase();
    const timeM = l.match(/at\s+(\d{1,2})[.:](\d{2})h?/i);
    deliveryMap[cntr] = {
      datum: parseDatumEN(dateM[1]),
      tijd:  timeM ? `${timeM[1].padStart(2,'0')}:${timeM[2]}:00` : ''
    };
  }
  if (Object.keys(deliveryMap).length > 0) {
    console.log('📅 B2L deliveryMap:', Object.entries(deliveryMap).map(([k,v]) => `${k}: ${v.datum} ${v.tijd}`).join(', '));
  }

  // === Datum & Tijd ===
  // Voorkeur 1: DATE/TIME: regel  (bijv. "DATE/TIME:30-APR-2026 AT 08.00H")
  // Voorkeur 2: datumregel in scheduling-tabel
  // Fallback: documentdatum
  const dateTimeLine  = ls.find(l => /DATE[\/]?TIME\s*:/i.test(l));
  const loadDatumEN   = dateTimeLine?.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/)?.[1]
                     || ls.find(l => /40ft High Cube/i.test(l))?.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/)?.[1]
                     || '';
  const docDatum      = ls.find(l => /^\d{2}-\d{2}-\d{4}$/.test(l)) || '';
  const datum         = parseDatumEN(loadDatumEN) || parseDatumNL(docDatum);

  // Tijden: alle regels met "AT HH.MMH" patroon (zoals "DATE/TIME:30-APR-2026 AT 08.00H")
  const tijden = ls
    .filter(l => /\bAT\s+\d{2}[.:]\d{2}H?\b/i.test(l))
    .map(l => {
      const m = l.match(/\bAT\s+(\d{2})[.:](\d{2})H?\b/i);
      return m ? `${m[1]}:${m[2]}:00` : '';
    })
    .filter(Boolean);

  // === Formaat detectie: export vs import ===
  // ANCHORED zoek: voorkomt dat routing-regels ("FROM X TO Y TO Z") matchen.
  const hasPlaceOfLoading  = ls.some(l => /^PLACE\s+OF\s+LOADING\s*:?\s*$/i.test(l));
  const hasPlaceOfDelivery = ls.some(l => /^PLACE\s+OF\s+(?:DELIVERY|UNLOADING|DISCHARGE)\s*:?\s*$|^DELIVERY\s+ADDRESS\s*:?\s*$/i.test(l));
  const isImport = !hasPlaceOfLoading && hasPlaceOfDelivery;
  console.log(`🔀 B2L formaat: ${isImport ? 'IMPORT (lossen)' : 'EXPORT (laden)'}`);

  // === Sectie-indices (ANCHORED — slaan routing-regels over) ===
  // Sectie-headers staan als standalone regel met optionele ":" aan het einde.
  const epuIdx = ls.findIndex(l => /^(?:EMPTY|FULL)\s+PICK-?UP\s+TERMINAL\s*:?\s*$/i.test(l));
  const polIdx = ls.findIndex(l => /^PLACE\s+OF\s+LOADING\s*:?\s*$/i.test(l));
  const fdtIdx = ls.findIndex(l => /^FULL\s+DELIVERY\s+TERMINAL\s*:?\s*$/i.test(l));
  const podIdx = ls.findIndex(l => /^PLACE\s+OF\s+(?:DELIVERY|UNLOADING|DISCHARGE)\s*:?\s*$|^DELIVERY\s+ADDRESS\s*:?\s*$/i.test(l));
  const erdIdx = ls.findIndex(l => /^EMPTY\s+(?:RETURN|DELIVERY)\s+TERMINAL\s*:?\s*$|^EMPTY\s+DEPOT\s*:?\s*$/i.test(l));

  // === Referenties ===
  // Terminal/boekingsreferentie (uit EMPTY/FULL PICK-UP TERMINAL sectie)
  // Bijv. "KRAMER CITY DEPOTREFERENCE:YMTRTM0031219" → "YMTRTM0031219"
  const referentie = epuIdx >= 0
    ? (ls[epuIdx + 1] || '').replace(/.*REFERENCE[:\s]*/i, '').trim()
    : '';

  // Laadreferentie: klantreferentie uit PLACE OF LOADING (export) of PLACE OF DELIVERY (import)
  // Bijv. "LOGWISE B.V.REFERENCE:TBA" → "TBA"
  const laadSecIdx = isImport ? podIdx : polIdx;
  const laadreferentie = laadSecIdx >= 0
    ? (ls[laadSecIdx + 1] || '').replace(/.*REFERENCE[:\s]*/i, '').trim()
    : '';

  // === Rederij & Bootnaam ===
  // Combinatieregel: "CARRIER:YANG MING (NETHERLANDS) BVMAIN VESSEL:ONE HAMMERSMITH"
  const voyageLine = ls.find(l => /CARRIER.*MAIN VESSEL|MAIN VESSEL.*CARRIER/i.test(l));
  const rederijRaw = voyageLine?.match(/CARRIER[:\s]+(.+?)(?=MAIN VESSEL)/i)?.[1]?.trim() || '';
  const bootnaam   = voyageLine?.match(/MAIN VESSEL[:\s]+(.+)/i)?.[1]?.trim() || '';

  // === Locaties — export vs import ===
  let opzettenNaam = '', opzettenAdres = '';
  let klantNaam = '', klantAdres = '', klantPCPlaats = '', klantLand = '';
  let laadActie = 'Laden';
  let afzettenNaam = '', afzettenAdres = '', afzettenPCPlaats = '';

  if (!isImport) {
    // ── Export: lege container ophalen (Opzetten) → laden bij klant → terminal inleveren (Afzetten) ──
    if (epuIdx >= 0) {
      const { line, idx } = nextRealLine(ls, epuIdx + 1);
      opzettenNaam  = line;
      opzettenAdres = safeAdres(ls, idx + 1);
    }
    if (polIdx >= 0) {
      const { line, idx } = nextRealLine(ls, polIdx + 1);
      klantNaam     = line;
      klantAdres    = safeAdres(ls, idx + 1);
      klantPCPlaats = safeAdres(ls, idx + 2);
      klantLand     = safeAdres(ls, idx + 3);
    }
    laadActie = 'Laden';
    if (fdtIdx >= 0) {
      const { line, idx } = nextRealLine(ls, fdtIdx + 1);
      afzettenNaam     = line;
      afzettenAdres    = safeAdres(ls, idx + 1);
      afzettenPCPlaats = safeAdres(ls, idx + 2);
    }
  } else {
    // ── Import: volle container ophalen (Opzetten) → lossen bij klant → leeg depot retour (Afzetten) ──
    if (epuIdx >= 0) {
      const { line, idx } = nextRealLine(ls, epuIdx + 1);
      opzettenNaam  = line;
      opzettenAdres = safeAdres(ls, idx + 1);
    }
    if (podIdx >= 0) {
      const { line, idx } = nextRealLine(ls, podIdx + 1);
      klantNaam     = line;
      klantAdres    = safeAdres(ls, idx + 1);
      klantPCPlaats = safeAdres(ls, idx + 2);
      klantLand     = safeAdres(ls, idx + 3);
    }
    laadActie = 'Lossen';
    if (erdIdx >= 0) {
      const { line, idx } = nextRealLine(ls, erdIdx + 1);
      afzettenNaam     = line;
      afzettenAdres    = safeAdres(ls, idx + 1);
      afzettenPCPlaats = safeAdres(ls, idx + 2);
    }
  }

  console.log(`🔍 B2L opzetten: "${opzettenNaam}" | adres: "${opzettenAdres}"`);
  console.log(`🔍 B2L klant:    "${klantNaam}" | adres: "${klantAdres}"`);
  console.log(`🔍 B2L afzetten: "${afzettenNaam}" | adres: "${afzettenAdres}"`);

  // === Postcode + plaats uit klantPCPlaats ("3225 MA, HELLEVOETSLUIS" of "3225MA HELLEVOETSLUIS") ===
  const pcMatch     = klantPCPlaats.match(/^(\d{4}\s*[A-Z]{2})[,\s]+(.+)/i);
  const klantPC     = pcMatch?.[1]?.replace(/(\d{4})\s*([A-Z]{2})/, '$1 $2') || '';
  const klantPlaats = pcMatch?.[2]?.trim() || '';

  // === Instructies ===
  const instrStart = ls.findIndex(l => /SPECIAL INSTRUCTIONS/i.test(l));
  const instrEind  = ls.findIndex(l => /GENERAL INFORMATION/i.test(l));
  const instructies = (instrStart >= 0 && instrEind > instrStart)
    ? ls.slice(instrStart + 1, instrEind).filter(Boolean).join(' ').slice(0, 300)
    : '';

  // === Ruwe postcode/plaats voor afzetten uit klantPCPlaats-achtige string ===
  const afzetPostcode = afzettenPCPlaats.match(/\d{4}\s*[A-Z]{2}/i)?.[0]?.replace(/(\d{4})\s*([A-Z]{2})/, '$1 $2') || '';
  const afzetPlaats   = afzettenPCPlaats.replace(/^\d{4}\s*[A-Z]{2}[,\s]*/i, '').split(',')[0].trim() || '';

  // === Bouw resultaat per container — enrichOrder doet alle lookups ===
  // Gebruik RIDER-containers als die gevonden zijn, anders generieke telling
  const containerLijst = riderContainers.length > 0
    ? riderContainers
    : Array.from({ length: containerCount }, () => ({
        containernummer: containerNummerPDF || '',
        gewicht,
        colli: '0'
      }));

  const results = [];
  for (let i = 0; i < containerLijst.length; i++) {
    const cData    = containerLijst[i];
    const delivery = deliveryMap[cData.containernummer] || {};
    const cDatum   = delivery.datum || datum;
    const cTijd    = delivery.tijd  || tijden[i] || '';

    // Ruwe locaties: enrichOrder doet terminal + adresboek lookups
    const locaties = [
      {
        volgorde: '0', actie: 'Opzetten',
        naam: opzettenNaam, adres: opzettenAdres, postcode: '', plaats: '', land: 'NL'
      },
      {
        volgorde: '0', actie: laadActie,
        naam: klantNaam, adres: klantAdres, postcode: klantPC, plaats: klantPlaats,
        land: normLand(klantLand || 'NL')
      },
      {
        volgorde: '0', actie: 'Afzetten',
        naam: afzettenNaam, adres: afzettenAdres, postcode: afzetPostcode, plaats: afzetPlaats, land: 'NL'
      }
    ];

    results.push(await enrichOrder({
      ritnummer,
      klantnaam:     klantNaam,
      klantadres:    klantAdres,
      klantpostcode: klantPC,
      klantplaats:   klantPlaats,

      opdrachtgeverNaam:     'B2L CARGOCARE',
      opdrachtgeverAdres:    'NIEUWESLUISWEG 240',
      opdrachtgeverPostcode: '3197 KV',
      opdrachtgeverPlaats:   'BOTLEK',
      opdrachtgeverTelefoon: '',
      opdrachtgeverEmail:    'export@b2l-cargocare.com',
      opdrachtgeverBTW:      'NL855659324B01',
      opdrachtgeverKVK:      '64421406',

      containernummer: cData.containernummer || containerNummerPDF || '',
      containertype,

      datum:  cDatum,
      tijd:   cTijd,
      referentie,
      laadreferentie,
      inleverreferentie: referentie,
      inleverBestemming: '',

      rederijRaw,
      rederij:         '',
      bootnaam,
      inleverBootnaam: bootnaam,
      inleverRederij:  '',

      zegel:          '',
      colli:          cData.colli  || '0',
      lading,
      brutogewicht:   cData.gewicht || gewicht,
      geladenGewicht: cData.gewicht || gewicht,
      cbm:            '0',

      adr:           'Onwaar',
      ladenOfLossen: isImport ? 'Lossen' : 'Laden',
      instructies,
      tar: '', documentatie: '', tarra: '0', brix: '0',

      locaties
    }, { bron: 'B2L' }));
  }

  console.log(`✅ parseB2L: ${results.length} container(s)`);
  return results;
}
