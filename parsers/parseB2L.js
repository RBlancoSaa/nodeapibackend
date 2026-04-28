// parsers/parseB2L.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode,
  getRederijNaam,
  normLand,
  cleanFloat
} from '../utils/lookups/terminalLookup.js';

const MONTHS_EN = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function parseDatumNL(str) {
  const m = (str || '').match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (!m) return '';
  return `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}-${m[3]}`;
}

function parseDatumEN(str) {
  // "22-Apr-2026" or "29-APR-2026"
  const m = (str || '').match(/(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/);
  if (!m) return '';
  const maand = MONTHS_EN[m[2].toLowerCase()];
  if (!maand) return '';
  return `${m[1].padStart(2,'0')}-${String(maand).padStart(2,'0')}-${m[3]}`;
}

function valAfterLabel(line, label) {
  return line?.replace(new RegExp(`.*${label}[:\\s]*`, 'i'), '').trim() || '';
}

export default async function parseB2L(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { text } = await pdfParse(buffer);
  // Deduplicate lines (PDF has 3 identical page headers)
  const seen = new Set();
  const ls = text.split('\n')
    .map(r => r.trim())
    .filter(r => r && !seen.has(r) && seen.add(r));
  console.log('📋 B2L regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // === Referentie / ritnummer ===
  const refIdx  = ls.findIndex(l => /^REFERENTIE$/i.test(l));
  const ritnummer = refIdx >= 0 ? (ls[refIdx + 1] || '') : '';

  // === Datum (voorkeur: laaddatum uit schedule, fallback: documentdatum) ===
  const docDatum = ls.find(l => /^\d{2}-\d{2}-\d{4}$/.test(l)) || '';

  // Loading schedule dates
  const schedLine = ls.find(l => /40ft High Cube/i.test(l));
  const loadDatumEN = schedLine?.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/)?.[1] || '';
  const datum = parseDatumEN(loadDatumEN) || parseDatumNL(docDatum);

  // Load times from schedule
  const tijden = ls
    .filter(l => /at\s+\d{2}[:.]\d{2}h?/i.test(l))
    .map(l => l.match(/(\d{2})[.:.](\d{2})/)?.[0]?.replace('.', ':') + ':00' || '');

  // === Container type ===
  const containerSetLine = ls.find(l => /CONTAINER SET/i.test(l));
  const countMatch = containerSetLine?.match(/(\d+)X\s+(.+)/i);
  const containerCount = parseInt(countMatch?.[1] || '1');
  const containertypeRaw = countMatch?.[2]?.trim() || '40FT HIGH CUBE';
  const containertype = /high.?cube|HC/i.test(containertypeRaw)
    ? (/40/i.test(containertypeRaw) ? '40ft HC' : '45ft HC')
    : (/40/i.test(containertypeRaw) ? '40ft' : '20ft');

  // === Cargo ===
  const cargoLine  = ls.find(l => /CARGO DESCRIPTION/i.test(l));
  const weightLine = ls.find(l => /ESTIMATED WEIGHT/i.test(l));
  const lading  = valAfterLabel(cargoLine,  'CARGO DESCRIPTION');
  const kgMatch = weightLine?.match(/([\d.,]+)\s*KGS?/i);
  const gewicht = kgMatch ? String(Math.round(parseFloat(kgMatch[1].replace(',', '.')))) : '0';

  // === Referenties ===
  const opzettenRefLine = ls.find(l => /EMPTY PICK-UP TERMINAL/i.test(l));
  const opzettenRef     = valAfterLabel(ls.find(l => /^QTERMINALS|Qterminals/i.test(l)) || opzettenRefLine, 'REFERENCE') || '';
  // Simplify: extract from next line after EMPTY PICK-UP TERMINAL
  const epuIdx = ls.findIndex(l => /EMPTY PICK-UP TERMINAL/i.test(l));
  const referentie = epuIdx >= 0
    ? (ls[epuIdx + 1] || '').replace(/.*REFERENCE[:\s]*/i, '').trim()
    : '';

  // === Rederij & Bootnaam ===
  const voyageLine = ls.find(l => /CARRIER.*MAIN VESSEL|MAIN VESSEL.*CARRIER/i.test(l));
  const rederijRaw  = voyageLine?.match(/CARRIER[:\s]+(.+?)(?=MAIN VESSEL)/i)?.[1]?.trim() || '';
  const bootnaam    = voyageLine?.match(/MAIN VESSEL[:\s]+(.+)/i)?.[1]?.trim() || '';
  const etsLine     = ls.find(l => /ETS[:\s]/i.test(l));
  const etsRaw      = etsLine?.match(/ETS[:\s]*(\d{1,2}-[A-Za-z]{3}-\d{4})/i)?.[1] || '';
  const etsDatum    = parseDatumEN(etsRaw);

  // === Locaties ===
  // Opzetten: EMPTY PICK-UP TERMINAL
  const epuLine   = ls[epuIdx + 1] || ''; // "QTERMINALS KRAMER CITYREFERENCE:YMTRTM0031329"
  const opzettenNaam = epuLine.replace(/REFERENCE.*/i, '').trim();
  const opzettenAdres = ls[epuIdx + 2] || '';

  // Laden: PLACE OF LOADING
  const polIdx    = ls.findIndex(l => /PLACE OF LOADING/i.test(l));
  const polLine   = ls[polIdx + 1] || ''; // "REHO DODEWAARD BVREFERENCE:TBA"
  const klantNaam = polLine.replace(/REFERENCE.*/i, '').trim();
  const klantAdres = ls[polIdx + 2] || '';
  const klantPCPlaats = ls[polIdx + 3] || '';
  const klantLand = ls[polIdx + 4] || '';

  // Parse "6541 CS NIJMEGEN"
  const pcMatch = klantPCPlaats.match(/^(\d{4}\s?[A-Z]{2})\s+(.+)/i);
  const klantPC   = pcMatch?.[1]?.replace(/(\d{4})([A-Z]{2})/, '$1 $2') || klantPCPlaats;
  const klantPlaats = pcMatch?.[2] || '';

  // Afzetten: FULL DELIVERY TERMINAL
  const fdtIdx    = ls.findIndex(l => /FULL DELIVERY TERMINAL/i.test(l));
  const fdtLine   = ls[fdtIdx + 1] || ''; // "ECT DELTA TERMINALREFERENCE:YMTRTM0031329"
  const afzettenNaam = fdtLine.replace(/REFERENCE.*/i, '').trim();
  const afzettenAdres = ls[fdtIdx + 2] || '';
  const afzettenPCPlaats = ls[fdtIdx + 3] || '';

  // Terminal lookups
  const [opzettenInfo, afzettenInfo] = await Promise.all([
    getTerminalInfoMetFallback(opzettenNaam),
    getTerminalInfoMetFallback(afzettenNaam)
  ]);
  const ctCode      = await getContainerTypeCode(containertype);
  const rederijNaam = await getRederijNaam(rederijRaw.split(' ')[0]) || rederijRaw;

  const instructies = ls
    .slice(ls.findIndex(l => /SPECIAL INSTRUCTIONS/i.test(l)) + 1,
           ls.findIndex(l => /GENERAL INFORMATION/i.test(l)))
    .filter(Boolean)
    .join(' ')
    .slice(0, 300);

  // === Bouw resultaat per container ===
  const results = [];
  for (let i = 0; i < containerCount; i++) {
    const tijd = tijden[i] || '';

    const locaties = [
      {
        volgorde: '0', actie: 'Opzetten',
        naam:     opzettenInfo?.naam     || opzettenNaam,
        adres:    opzettenInfo?.adres    || opzettenAdres,
        postcode: opzettenInfo?.postcode || '',
        plaats:   opzettenInfo?.plaats   || '',
        land:     normLand(opzettenInfo?.land || 'NL'),
        voorgemeld: opzettenInfo?.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
        aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
        portbase_code: cleanFloat(opzettenInfo?.portbase_code || ''),
        bicsCode:      cleanFloat(opzettenInfo?.bicsCode      || '')
      },
      {
        volgorde: '0', actie: 'Laden',
        naam:     klantNaam,
        adres:    klantAdres,
        postcode: klantPC,
        plaats:   klantPlaats,
        land:     klantLand === 'NETHERLANDS' ? 'NL' : (klantLand || 'NL')
      },
      {
        volgorde: '0', actie: 'Afzetten',
        naam:     afzettenInfo?.naam     || afzettenNaam,
        adres:    afzettenInfo?.adres    || afzettenAdres,
        postcode: afzettenInfo?.postcode || afzettenPCPlaats.match(/\d{4}\s?[A-Z]{2}/i)?.[0] || '',
        plaats:   afzettenInfo?.plaats   || afzettenPCPlaats.replace(/^\d{4}\s?[A-Z]{2},?\s*/i, '').split(',')[0].trim(),
        land:     normLand(afzettenInfo?.land || 'NL'),
        voorgemeld: afzettenInfo?.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
        aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
        portbase_code: cleanFloat(afzettenInfo?.portbase_code || ''),
        bicsCode:      cleanFloat(afzettenInfo?.bicsCode      || '')
      }
    ];

    results.push({
      ritnummer,
      klantnaam:    klantNaam,
      klantadres:   klantAdres,
      klantpostcode: klantPC,
      klantplaats:  klantPlaats,

      opdrachtgeverNaam:     'B2L CARGOCARE B.V.',
      opdrachtgeverAdres:    'WEENA 70',
      opdrachtgeverPostcode: '3012 CM',
      opdrachtgeverPlaats:   'ROTTERDAM',
      opdrachtgeverTelefoon: '010-3070338',
      opdrachtgeverEmail:    'export@b2l-cargocare.com',
      opdrachtgeverBTW:      'NL855659324B01',
      opdrachtgeverKVK:      '57',

      containernummer: '',
      containertype,
      containertypeCode: ctCode || '0',

      datum,
      tijd,
      referentie,
      laadreferentie:    referentie,
      inleverreferentie: referentie,
      inleverBestemming: '',

      rederij:        rederijNaam || rederijRaw,
      bootnaam,
      inleverRederij: rederijNaam || rederijRaw,
      inleverBootnaam: bootnaam,

      zegel: '',
      colli: '0',
      lading,
      brutogewicht:   gewicht,
      geladenGewicht: gewicht,
      cbm: '0',

      adr: 'Onwaar',
      ladenOfLossen: 'Laden',
      instructies,
      tar: '', documentatie: '', tarra: '0', brix: '0',

      locaties
    });
  }

  console.log(`✅ parseB2L: ${results.length} container(s)`);
  return results;
}
