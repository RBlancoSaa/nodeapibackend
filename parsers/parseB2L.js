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
// Inclusief "SEE RELEASE" instructie-zinnen en email-adressen die soms als terminalregel verschijnen
const SECTION_LABEL_RE = /^(?:SEE\s+RELEASE\b)|^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\s*$|^(?:EMPTY|FULL)\s+PICK-?UP\s+TERMINAL|^FULL\s+DELIVERY\s+TERMINAL|^EMPTY\s+(?:RETURN|DELIVERY)\s+TERMINAL|^EMPTY\s+DEPOT|^PLACE\s+OF\s+(?:LOADING|DELIVERY|UNLOADING|DISCHARGE|EXTRA)|^DELIVERY\s+ADDRESS|^DATE\/?TIME|^PORT\s+(?:OF|NUMBER)|^VOYAGE|^CARRIER|^MAIN\s+VESSEL|^ROUTINGS|^FROM\s+/i;

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

/**
 * Extracts REFERENCE: value from lines starting at fromIdx.
 * Handles combined lines like "LOGWISE B.V.REFERENCE:26050038 - NVWA".
 */
function extractRef(ls, fromIdx, maxLines = 3) {
  for (let i = fromIdx; i < Math.min(fromIdx + maxLines, ls.length); i++) {
    const m = (ls[i] || '').match(/REFERENCE[:\s]+(.+)/i);
    if (m) return m[1].trim();
  }
  return '';
}

/**
 * Extracts a multi-line address block starting at startIdx.
 * Handles Dutch addresses like:
 *   "IND.TERRAIN BT A12,"
 *   "SCHABERNAUSEWEG 1"
 *   "6718 XE EDE GLD, NETHERLANDS"
 * Returns { adres, postcode, plaats, land }.
 * `adres` = last non-postcode address line (e.g. "SCHABERNAUSEWEG 1").
 */
function extractAdresBlok(ls, startIdx, maxLines = 8) {
  const end = Math.min(startIdx + maxLines, ls.length);
  const adresLijnen = [];
  let postcode = '', plaats = '', land = 'NL';

  for (let i = startIdx; i < end; i++) {
    const raw = (ls[i] || '').trim();
    if (!raw) break;
    if (SECTION_LABEL_RE.test(raw)) break;

    // Postcode-regel herkenning: "1234 AB, STAD" of "1234 AB STAD" of "1234 AB STAD PROV, LAND"
    const pcM = raw.match(/^(\d{4}\s*[A-Z]{2})[,\s]+(.+)/i);
    if (pcM) {
      postcode = pcM[1].replace(/(\d{4})\s*([A-Z]{2})/i, '$1 $2');
      const rest = pcM[2].trim();
      const restDelen = rest.split(',');
      const plaatsDelen = restDelen[0].trim().split(/\s+/);
      // Verwijder provincieafkorting (2-3 hoofdletters) aan het einde (bijv. "GLD", "ZH", "NH")
      if (plaatsDelen.length > 1 && /^[A-Z]{2,3}$/.test(plaatsDelen[plaatsDelen.length - 1])) {
        plaatsDelen.pop();
      }
      plaats = plaatsDelen.join(' ').trim();
      if (restDelen.length > 1) {
        const landStr = restDelen[restDelen.length - 1].trim();
        land = normLand(landStr) || 'NL';
      }
      break; // klaar na postcoderegel
    }
    adresLijnen.push(raw);
  }

  // Gebruik de LAATSTE adresregel als primair adres (bijv. "SCHABERNAUSEWEG 1")
  const adres = adresLijnen[adresLijnen.length - 1] || '';
  return { adres, postcode, plaats, land };
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
  const containertype    = /open.?top/i.test(containertypeRaw)
    ? (/40/i.test(containertypeRaw) ? '40ft open top' : '20ft open top')
    : /high.?cube|HC/i.test(containertypeRaw)
      ? (/40/i.test(containertypeRaw) ? '40ft HC' : '45ft HC')
      : (/40/i.test(containertypeRaw) ? '40ft' : '20ft');

  // === Cargo ===
  const cargoLine  = ls.find(l => /CARGO DESCRIPTION/i.test(l));
  const weightLine = ls.find(l => /ESTIMATED WEIGHT/i.test(l));
  let lading    = valAfterLabel(cargoLine,  'CARGO DESCRIPTION');
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

  // RIDER-formaat: daar is "CARGO DESCRIPTION" een kolom-kop (geen label), dus
  // valAfterLabel pakt de kop-rest ("Packages Gross Weight Volume"). Haal de
  // echte omschrijving dan uit de eerste RIDER-datarij (na container + zegel,
  // vóór de packages/gewicht/volume-regel). Alleen bij een kop-restant, zodat
  // het label-formaat dat nu wél werkt onaangeroerd blijft.
  if (riderIdx >= 0 && (!lading || /packages|gross\s*weight|volume/i.test(lading))) {
    for (let i = riderIdx + 1; i < ls.length; i++) {
      if (!CNTR_RE.test(ls[i].trim())) continue;
      const delen = [];
      for (let j = i + 1; j < Math.min(i + 12, ls.length); j++) {
        const lj = ls[j].trim();
        if (CNTR_RE.test(lj)) break;
        if (/^SEAL:?$/i.test(lj)) continue;
        if (/^[A-Z0-9]{6,}$/.test(lj) && delen.length === 0) continue; // zegelwaarde
        if (/\bkgs?\b|\bm3\b|^\d+\s*[xX]\s/i.test(lj)) break;           // packages/gewicht/volume
        if (/^delivery reference/i.test(lj)) break;
        const stripped = lj.replace(/^\d{2,3}ft\s*(high\s*cube|hc|standard|std|dv|reefer)?/i, '').trim();
        if (stripped) delen.push(stripped);
      }
      const riderCargo = delen.join(' ').trim();
      if (riderCargo) lading = riderCargo;
      break;
    }
  }

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
  const pesIdx = ls.findIndex(l => /^PLACE\s+OF\s+EXTRA\s+STOP\s*:?\s*$/i.test(l));
  const fdtIdx = ls.findIndex(l => /^FULL\s+DELIVERY\s+TERMINAL\s*:?\s*$/i.test(l));
  const podIdx = ls.findIndex(l => /^PLACE\s+OF\s+(?:DELIVERY|UNLOADING|DISCHARGE)\s*:?\s*$|^DELIVERY\s+ADDRESS\s*:?\s*$/i.test(l));
  const erdIdx = ls.findIndex(l => /^EMPTY\s+(?:RETURN|DELIVERY)\s+TERMINAL\s*:?\s*$|^EMPTY\s+DEPOT\s*:?\s*$/i.test(l));

  console.log(`🔎 B2L sectie-indices: epu=${epuIdx} pol=${polIdx} pes=${pesIdx} fdt=${fdtIdx} pod=${podIdx} erd=${erdIdx}`);

  // === Referenties per sectie ===
  // extractRef haalt REFERENCE: op uit een gecombineerde naamregel (bijv. "LOGWISE B.V.REFERENCE:26050038 - NVWA")
  const epuRef = epuIdx >= 0 ? extractRef(ls, epuIdx + 1) : '';
  const polRef = polIdx >= 0 ? extractRef(ls, polIdx + 1) : '';
  const pesRef = pesIdx >= 0 ? extractRef(ls, pesIdx + 1) : '';
  const fdtRef = fdtIdx >= 0 ? extractRef(ls, fdtIdx + 1) : '';
  const podRef = podIdx >= 0 ? extractRef(ls, podIdx + 1) : '';
  const erdRef = erdIdx >= 0 ? extractRef(ls, erdIdx + 1) : '';

  // Veldmapping:
  //   Export: referentie = POL ref (laadlocatie), laadreferentie = PES ref (extra stop), inleverreferentie = FDT ref (terminal)
  //   Import: referentie = EPU ref (terminal), laadreferentie = POD ref (loslocatie), inleverreferentie = ERD ref (leeg depot)
  const referentie        = isImport ? epuRef : polRef;
  const laadreferentie    = isImport ? podRef : pesRef;
  const inleverreferentie = isImport ? erdRef : fdtRef;

  console.log(`📎 B2L refs: referentie="${referentie}" laad="${laadreferentie}" inlever="${inleverreferentie}"`);

  // === Rederij & Bootnaam ===
  // Combinatieregel: "CARRIER:YANG MING (NETHERLANDS) BVMAIN VESSEL:ONE HAMMERSMITH"
  const voyageLine = ls.find(l => /CARRIER.*MAIN VESSEL|MAIN VESSEL.*CARRIER/i.test(l));
  const rederijRaw = voyageLine?.match(/CARRIER[:\s]+(.+?)(?=MAIN VESSEL)/i)?.[1]?.trim() || '';
  const bootnaam   = voyageLine?.match(/MAIN VESSEL[:\s]+(.+)/i)?.[1]?.trim() || '';

  // === PORT OF DISCHARGE → bestemming (altijd, import én export) ===
  // Formaat A (gecombineerd): "PORT OF DISCHARGE:DURBAN, SOUTH AFRICA"
  // Formaat B (twee regels):  "PORT OF DISCHARGE:" gevolgd door "DURBAN, SOUTH AFRICA"
  const portOfDischargeIdx  = ls.findIndex(l => /^PORT\s+OF\s+DISCHARGE\s*:?\s*/i.test(l));
  let portOfDischarge = '';
  if (portOfDischargeIdx >= 0) {
    const podLine = ls[portOfDischargeIdx] || '';
    const inline  = podLine.replace(/^PORT\s+OF\s+DISCHARGE\s*:\s*/i, '').trim();
    if (inline) {
      // Formaat A: waarde staat op dezelfde regel
      portOfDischarge = inline.split(',')[0].trim();
    } else if (ls[portOfDischargeIdx + 1]) {
      // Formaat B: waarde staat op de volgende regel
      portOfDischarge = (ls[portOfDischargeIdx + 1] || '').split(',')[0].trim();
    }
  }
  if (portOfDischarge) console.log(`🌍 B2L PORT OF DISCHARGE: "${portOfDischarge}"`);

  // === Locaties — export vs import ===
  let opzettenNaam = '', opzettenAdres = '';
  let klantNaam = '', klantAdres = '', klantPC = '', klantPlaats = '', klantLand = 'NL';
  let pesNaam = '', pesAdres = '', pesPC = '', pesPlaats = '', pesLand = 'NL';
  let laadActie = 'Laden';
  let afzettenNaam = '', afzettenAdres = '';

  if (!isImport) {
    // ── Export: lege container ophalen (Opzetten/EPU) → laden bij klant (POL) → optionele extra stop (PES) → terminal inleveren (Afzetten/FDT) ──
    if (epuIdx >= 0) {
      const { line, idx } = nextRealLine(ls, epuIdx + 1);
      opzettenNaam  = line;
      opzettenAdres = safeAdres(ls, idx + 1);
    }
    if (polIdx >= 0) {
      const { line, idx } = nextRealLine(ls, polIdx + 1);
      klantNaam = line;
      const blok = extractAdresBlok(ls, idx + 1);
      klantAdres  = blok.adres;
      klantPC     = blok.postcode;
      klantPlaats = blok.plaats;
      klantLand   = blok.land;
    }
    laadActie = 'Laden';
    if (pesIdx >= 0) {
      const { line, idx } = nextRealLine(ls, pesIdx + 1);
      pesNaam = line;
      const blok = extractAdresBlok(ls, idx + 1);
      pesAdres  = blok.adres;
      pesPC     = blok.postcode;
      pesPlaats = blok.plaats;
      pesLand   = blok.land;
    }
    if (fdtIdx >= 0) {
      const { line, idx } = nextRealLine(ls, fdtIdx + 1);
      afzettenNaam  = line;
      afzettenAdres = safeAdres(ls, idx + 1);
    }
  } else {
    // ── Import: volle container ophalen (Opzetten/EPU) → lossen bij klant (POD) → leeg depot retour (Afzetten/ERD) ──
    if (epuIdx >= 0) {
      const { line, idx } = nextRealLine(ls, epuIdx + 1);
      opzettenNaam  = line;
      opzettenAdres = safeAdres(ls, idx + 1);
    }
    if (podIdx >= 0) {
      const { line, idx } = nextRealLine(ls, podIdx + 1);
      klantNaam = line;
      const blok = extractAdresBlok(ls, idx + 1);
      klantAdres  = blok.adres;
      klantPC     = blok.postcode;
      klantPlaats = blok.plaats;
      klantLand   = blok.land;
    }
    laadActie = 'Lossen';
    if (erdIdx >= 0) {
      const { line, idx } = nextRealLine(ls, erdIdx + 1);
      afzettenNaam  = line;
      afzettenAdres = safeAdres(ls, idx + 1);
    }
  }

  console.log(`🔍 B2L opzetten: "${opzettenNaam}" | adres: "${opzettenAdres}"`);
  console.log(`🔍 B2L klant:    "${klantNaam}" | adres: "${klantAdres}" | pc: "${klantPC}" | plaats: "${klantPlaats}"`);
  if (pesNaam) console.log(`🔍 B2L extra stop: "${pesNaam}" | adres: "${pesAdres}" | pc: "${pesPC}" | plaats: "${pesPlaats}"`);
  console.log(`🔍 B2L afzetten: "${afzettenNaam}" | adres: "${afzettenAdres}"`);

  // === Instructies ===
  // Alles tussen "SPECIAL INSTRUCTIONS / COMMENTS" en "GENERAL INFORMATION" (of max 8 regels).
  // "GENERAL INFORMATION" is niet altijd aanwezig — gebruik dan positie-gebaseerde fallback.
  const instrStart    = ls.findIndex(l => /SPECIAL INSTRUCTIONS/i.test(l));
  const instrEindRaw  = ls.findIndex((l, i) => i > instrStart && /GENERAL INFORMATION/i.test(l));
  const instrEind     = instrEindRaw > instrStart
    ? instrEindRaw
    : (instrStart >= 0 ? Math.min(instrStart + 8, ls.length) : -1);
  const instructies   = instrStart >= 0
    ? ls.slice(instrStart + 1, instrEind).filter(Boolean).join(' | ').slice(0, 300)
    : '';

  // === Bouw resultaat per container — enrichOrder doet alle lookups ===
  // Prioriteit: 1) RIDER-containers (meeste info), 2) deliveryMap-nummers (datum per container),
  // 3) PDF container-nummer met telling uit CONTAINER SET
  const deliveryKeys = Object.keys(deliveryMap);
  const containerLijst = riderContainers.length > 0
    ? riderContainers
    : deliveryKeys.length > 1
      // Meerdere containers in delivery schedule → gebruik hun nummers
      ? deliveryKeys.map(cntr => ({ containernummer: cntr, gewicht, colli: '0' }))
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

    // Locaties opbouwen
    const locaties = [
      {
        volgorde: '0', actie: 'Opzetten',
        naam: opzettenNaam, adres: opzettenAdres, postcode: '', plaats: '', land: 'NL'
      },
      {
        volgorde: '0', actie: laadActie,
        naam: klantNaam, adres: klantAdres, postcode: klantPC, plaats: klantPlaats,
        land: klantLand
      },
    ];

    // Extra laadstop (alleen export, alleen als PLACE OF EXTRA STOP aanwezig)
    if (!isImport && pesNaam) {
      locaties.push({
        volgorde: '0', actie: 'Laden',
        naam: pesNaam, adres: pesAdres, postcode: pesPC, plaats: pesPlaats,
        land: pesLand
      });
    }

    locaties.push({
      volgorde: '0', actie: 'Afzetten',
      naam: afzettenNaam, adres: afzettenAdres, postcode: '', plaats: '', land: 'NL'
    });

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
      inleverreferentie,
      // PORT OF DISCHARGE altijd als bestemming — import én export
      inleverBestemming:      portOfDischarge || '',
      _inleverBestemmingFixed: !!portOfDischarge,

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
      _ladenOfLossenFixed: true,
      instructies,
      tar: '', documentatie: '', tarra: '0', brix: '0',

      locaties
    }, { bron: 'B2L' }));
  }

  console.log(`✅ parseB2L: ${results.length} container(s)`);
  return results;
}
