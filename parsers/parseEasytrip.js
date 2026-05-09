// parsers/parseEasytrip.js
// Parser voor Easytrip Excel-exports met historische ritten.
//
// Easytrip is een Microsoft Access transport-database; gebruikers kunnen
// custom rapporten exporteren. Kolomnamen variëren per rapport — daarom
// gebruikt deze parser een "synoniemen-tabel": voor elk normaliseerd veld
// staat een lijst kolomnaam-varianten die we accepteren.
//
// Pas COLUMN_SYNONYMS aan zodra je een nieuwe Easytrip-export ziet met
// andere kolomnamen. Houd lowercase + zonder accenten.

import XLSX from 'xlsx';

// ─── Kolom-synoniemen ─────────────────────────────────────────────────
// Key = ons normaliseerde veld; values = varianten zoals ze in Easytrip kunnen staan.
// Lowercase + zonder accenten/spaties (we normaliseren input ook zo).
const COLUMN_SYNONYMS = {
  ritnummer:       ['ritnummer', 'ritnr', 'ritno', 'opdrachtnummer', 'opdrachtnr', 'orderno', 'ordernummer', 'reisnummer', 'rit'],
  datum:           ['datum', 'ritdatum', 'opdrachtdatum', 'datumvoer', 'datumvan', 'date'],
  klant:           ['klant', 'opdrachtgever', 'debiteur', 'klantnaam', 'customer'],

  laad_naam:       ['laadadres', 'laadlocatie', 'laadplaats', 'laadbedrijf', 'afzender', 'shipper', 'vannaam', 'laden', 'pickup', 'pickuplocation'],
  laad_plaats:     ['laadplaats', 'laadstad', 'laadgemeente', 'vanplaats', 'pickupcity'],
  laad_postcode:   ['laadpostcode', 'pcvan', 'vanpostcode'],
  laad_land:       ['laadland', 'landvan', 'vanland', 'pickupcountry'],

  los_naam:        ['losadres', 'loslocatie', 'losbedrijf', 'ontvanger', 'consignee', 'naarnaam', 'lossen', 'delivery', 'deliverylocation'],
  los_plaats:      ['losplaats', 'losstad', 'losgemeente', 'naarplaats', 'deliverycity'],
  los_postcode:    ['lospostcode', 'pcnaar', 'naarpostcode'],
  los_land:        ['losland', 'landnaar', 'naarland', 'deliverycountry'],

  containertype:   ['containertype', 'cntrtype', 'containerformaat', 'type'],
  containernummer: ['containernummer', 'containernr', 'cntrnr', 'containerno'],
  gewicht_kg:      ['gewicht', 'gewichtkg', 'kg', 'weight', 'lading'],
  is_adr:          ['adr', 'gevaarlijkestoffen', 'gevaarlijk', 'imdg', 'unnummer'],

  basis_tarief:    ['basistarief', 'basis', 'rittarief', 'tarief', 'vrachtprijs', 'baseprice', 'rate'],
  adr_toeslag:     ['adrtoeslag', 'toeslagadr'],
  diesel_toeslag:  ['dieseltoeslag', 'brandstoftoeslag', 'fueltoeslag', 'fuel', 'brandstof'],
  wachtuur_aantal: ['wachtuur', 'wachturen', 'wachttijd', 'waiting', 'waitinghours', 'staan'],
  wachtuur_tarief: ['wachtuurbedrag', 'wachtuurtarief', 'wachturentarief'],
  totaal_bedrag:   ['totaal', 'totaalbedrag', 'totaalexcl', 'totalexcl', 'eindbedrag', 'amount'],

  kilometers:      ['kilometers', 'km', 'afstand', 'distance'],
  chauffeur:       ['chauffeur', 'driver'],
  voertuig:        ['voertuig', 'combinatie', 'kenteken', 'truck', 'wagen'],
};

// Velden die als "overige toeslagen" worden opgeslagen als ze worden herkend
// maar niet bovenaan staan. Voorbeelden: weekendtoeslag, scanningtoeslag, etc.
const OVERIGE_TOESLAG_PATTERNS = [
  /toeslag/i,
  /^extra/i,
  /weekend/i,
  /feestdag/i,
  /nachttarief/i,
  /scanning/i,
  /zegel/i,
  /tolweg/i,
];

// ─── Helpers ──────────────────────────────────────────────────────────
function normalizeKey(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function buildHeaderMap(headers) {
  // headers: array van kolomnamen uit het Excel.
  // Geeft terug: { normaliseerdVeld: kolomIndex }
  const map = {};
  const overige = [];

  headers.forEach((rawHeader, idx) => {
    const normHeader = normalizeKey(rawHeader);
    if (!normHeader) return;

    let matched = false;
    for (const [veld, synoniemen] of Object.entries(COLUMN_SYNONYMS)) {
      if (map[veld] !== undefined) continue;
      if (synoniemen.some(syn => normalizeKey(syn) === normHeader)) {
        map[veld] = idx;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Niet herkend — als het op een toeslag-naam lijkt, bewaren we als "overige"
      const isToeslag = OVERIGE_TOESLAG_PATTERNS.some(re => re.test(String(rawHeader)));
      if (isToeslag) overige.push({ idx, naam: String(rawHeader).trim() });
    }
  });

  return { map, overige };
}

function parseDatum(value) {
  if (value === null || value === undefined || value === '') return null;
  // Excel-datum als getal
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  // String — probeer DD-MM-YYYY of YYYY-MM-DD
  const s = String(value).trim();
  let m = s.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function parseGetal(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  // Verwijder valuta-tekens, spaties; vervang komma door punt
  const s = String(value).replace(/[€$£\s]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBool(value) {
  if (value === null || value === undefined || value === '') return false;
  const s = String(value).toLowerCase().trim();
  return ['1', 'ja', 'yes', 'true', 'waar', 'x', 'adr'].includes(s) || /\d/.test(s);
}

function parseString(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

// ─── Hoofdfunctie ─────────────────────────────────────────────────────
/**
 * Parse een Easytrip Excel-bestand.
 * @param {Buffer} buffer  - Inhoud van het .xlsx-bestand
 * @param {object} opts    - { sheetName?: string, klant?: string }
 * @returns {object} - { rijen: [...], headerMap, overigeKolommen, niet_herkend, totaalRijen }
 */
export function parseEasytripXlsx(buffer, opts = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: false });
  const sheetName = opts.sheetName || wb.SheetNames.find(n => !/macro|vba/i.test(n)) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    return { rijen: [], headerMap: {}, overigeKolommen: [], niet_herkend: [], totaalRijen: 0, error: 'Geen sheet gevonden' };
  }

  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (data.length < 2) {
    return { rijen: [], headerMap: {}, overigeKolommen: [], niet_herkend: [], totaalRijen: 0, error: 'Te weinig rijen (geen header + data)' };
  }

  const headers = data[0];
  const { map, overige } = buildHeaderMap(headers);

  // Welke kolommen herkenden we niet? (handig voor debugging)
  const herkendeIndices = new Set([...Object.values(map), ...overige.map(o => o.idx)]);
  const niet_herkend = headers
    .map((h, i) => ({ idx: i, naam: String(h || '').trim() }))
    .filter(h => !herkendeIndices.has(h.idx) && h.naam !== '');

  const rijen = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.every(c => c === '' || c === null || c === undefined)) continue;

    const get = (veld) => map[veld] !== undefined ? row[map[veld]] : null;

    const overigeToeslagen = {};
    for (const { idx, naam } of overige) {
      const v = parseGetal(row[idx]);
      if (v !== null && v !== 0) overigeToeslagen[naam] = v;
    }

    rijen.push({
      ritnummer:       parseString(get('ritnummer')),
      datum:           parseDatum(get('datum')),
      klant:           parseString(get('klant')) || opts.klant || null,

      laad_naam:       parseString(get('laad_naam')),
      laad_plaats:     parseString(get('laad_plaats')),
      laad_postcode:   parseString(get('laad_postcode')),
      laad_land:       parseString(get('laad_land')),

      los_naam:        parseString(get('los_naam')),
      los_plaats:      parseString(get('los_plaats')),
      los_postcode:    parseString(get('los_postcode')),
      los_land:        parseString(get('los_land')),

      containertype:   parseString(get('containertype')),
      containernummer: parseString(get('containernummer')),
      gewicht_kg:      parseGetal(get('gewicht_kg')),
      is_adr:          parseBool(get('is_adr')),

      basis_tarief:    parseGetal(get('basis_tarief')),
      adr_toeslag:     parseGetal(get('adr_toeslag')),
      diesel_toeslag:  parseGetal(get('diesel_toeslag')),
      wachtuur_aantal: parseGetal(get('wachtuur_aantal')),
      wachtuur_tarief: parseGetal(get('wachtuur_tarief')),
      overige_toeslagen: overigeToeslagen,
      totaal_bedrag:   parseGetal(get('totaal_bedrag')),

      kilometers:      parseGetal(get('kilometers')),
      chauffeur:       parseString(get('chauffeur')),
      voertuig:        parseString(get('voertuig')),

      raw:             Object.fromEntries(headers.map((h, i) => [String(h || `col${i}`), row[i] ?? null])),
    });
  }

  return {
    rijen,
    headerMap: map,
    overigeKolommen: overige.map(o => o.naam),
    niet_herkend: niet_herkend.map(h => h.naam),
    totaalRijen: rijen.length,
  };
}
