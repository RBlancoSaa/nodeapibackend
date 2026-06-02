// 📁 parsers/parseSteinweg.js
import '../utils/fsPatch.js';
import XLSX from 'xlsx';
import { enrichOrder } from '../utils/enrichOrder.js';
import { berekenVolTarief, berekenLeegTarief, berekenPairs } from '../utils/steinwegTarieven.js';
import { getPrijsafspraken } from '../utils/getPrijsafspraken.js';
import { getSteinwegAdres } from '../utils/lookups/terminalLookup.js';

/**
 * Berekent de order-specifieke toeslagen (ADR, genset, gasmeten, extra stop)
 * op basis van de afspraken en order-kenmerken.
 *
 * @param {object} opts
 * @param {number}  opts.tarief       - Basistarief (nodig voor ADR % berekening)
 * @param {boolean} opts.heeftAdr     - true als ADR/IMO aanwezig
 * @param {boolean} opts.heeftGenset  - true als genset vereist
 * @param {boolean} opts.heeftGasmeten- true als gasmeten vereist
 * @param {number}  opts.extraStops   - aantal extra laden/lossen stops (boven de standaard 1)
 * @param {object}  afspraken         - result van getPrijsafspraken()
 */
// ── Hardcoded standaard-toeslagen (worden gebruikt als database ontbreekt of 0 geeft) ──
const STD_ADR_PCT    = 10;    // ADR = 10% van het basistarief
const STD_GENSET     = 100;   // Genset toeslag = €100
const STD_EXTRA_STOP = 55;    // Extra stop = €55
// Diesel is fluctuerend — geen hardcoded fallback; moet in database staan

function calcOrderToeslagen({ tarief, heeftAdr, heeftGenset, heeftGasmeten, extraStops }, afspraken) {
  const adrPercent     = (afspraken?.toeslag('adr'))        || STD_ADR_PCT;    // 10%
  const adrBedrag      = heeftAdr ? (tarief * adrPercent / 100) : 0;
  const adrToeslag     = heeftAdr ? adrPercent : 0;                            // % in XML
  const genChart       = heeftGenset   ? ((afspraken?.toeslag('genset'))    || STD_GENSET)     : 0;
  const gasMetenChart  = heeftGasmeten ? ((afspraken?.toeslag('gasmeten'))  || 0)              : 0;
  const extraStopChart = extraStops > 0
    ? (((afspraken?.toeslag('extra_stop')) || STD_EXTRA_STOP) * extraStops)
    : 0;
  return { adrToeslagChart: adrToeslag, adrBedragChart: adrBedrag, genChart, gasMetenChart, extraStopChart };
}

function normLand(val) {
  const s = (val || '').trim().toUpperCase();
  if (!s) return 'NL';
  if (s === 'NEDERLAND' || s === 'NETHERLANDS') return 'NL';
  if (s === 'DUITSLAND' || s === 'GERMANY' || s === 'DEUTSCHLAND') return 'DE';
  if (s === 'BELGIE' || s === 'BELGIË' || s === 'BELGIUM') return 'BE';
  return s;
}

function normPostcode(val) {
  if (!val) return '';
  // "3089KN" → "3089 KN"
  return String(val).trim().replace(/^(\d{4})\s*([A-Z]{2})$/i, '$1 $2').toUpperCase();
}

function parseXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, bookVBA: false, bookFiles: false });
  const sheetName = wb.SheetNames.find(n => !/macro|vba/i.test(n)) || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

function findHeaderRowIdx(rows) {
  return rows.findIndex(r => r.some(cell => String(cell).trim() === 'Container'));
}

function cellAfterLabel(rows, labelRegex) {
  for (const row of rows) {
    for (let i = 0; i < row.length - 1; i++) {
      if (labelRegex.test(String(row[i]).trim())) {
        for (let j = i + 1; j < row.length; j++) {
          const v = String(row[j]).trim();
          if (v) return v;
        }
      }
    }
  }
  return '';
}

function parseDatum(str) {
  const m = String(str || '').match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${yyyy}`;
}

/** Probeer datum uit e-mailonderwerp te halen, bijv. "29-04" of "29-04-2026" */
function parseDateFromSubject(subject) {
  const full = parseDatum(subject);
  if (full) return full;
  // Gedeeltelijke datum: "29-04" → huidig jaar toevoegen
  const m = (subject || '').match(/\b(\d{1,2})[-.](\d{2})\b(?![-.\d])/);
  if (m) {
    const year = new Date().getFullYear();
    return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${year}`;
  }
  return '';
}

/**
 * Normaliseert haven-terminalnamen naar exacte namen uit op_afzetten.json.
 * ALLEEN voor haventerminals (Opzetten bij Route 1, Afzetten bij Route 2).
 * Steinweg-eigen vestigingen worden NIET via deze functie verwerkt.
 */
// Haven-terminals: deze MOETEN via de normale terminal-lookup (op_afzetten.json)
// portbase/bics-code krijgen. Géén `_noTerminalLookup: true`.
const HAVEN_TERMINALS = new Set([
  'ECT Delta', 'Euromax', 'RWG', 'APM 2', 'Apm / HUTCHISON PORTS DELTA 2',
  'WBT', 'Rst Zuid', 'Rst noord',
]);

function canonicalTerminalNaam(naam) {
  const s = (naam || '').toLowerCase().replace(/[\s\-_\/.,]+/g, ' ').trim();
  // ── Maasvlakte port-terminals ─────────────────────────────────────────
  if (/ect delta|ect home port|delta ii/.test(s))                        return 'ECT Delta';
  if (/euromax|emx/.test(s))                                             return 'Euromax';
  if (/\brwg\b|rotterdam world gateway/.test(s))                         return 'RWG';
  if (/apm[\s-]?2\b|apm.*maasvlakte\s*(ii|2)|apm.*mvii/.test(s))        return 'APM 2';
  if (/hpd[\s-]?2\b|hpd2|hutchison|apm[\s-]?1\b/.test(s))              return 'Apm / HUTCHISON PORTS DELTA 2';
  if (/\bwbt\b/.test(s))                                                 return 'WBT';
  if (/\brst\b/.test(s))                                                 return 'Rst Zuid';
  // ── Return-depots (Route 2) ───────────────────────────────────────────
  if (/dcs kramer|kramer.*delta|qterminals.*kramer|rct.*kramer|kramer.*rct/.test(s)) return 'DCS Kramer Group';
  if (/kramer.*distri|dr.*depot|van\s*doorn.*delta/.test(s))             return 'KRAMER DISTRI - DR Depot';
  if (/kramer.*home|kramer.*city|reeweg.*kramer/.test(s))                return 'Kramer home / city REEWEG';
  if (/medrepair|med repair/.test(s))                                    return 'MedRepair';
  if (/van\s*doorn/.test(s))                                             return 'VAN DOORN';
  if (/\buwt\b.*maasvlakte|maasvlakte.*\buwt\b/.test(s))                return 'UWT MAASVLAKTE';
  if (/\buwt\b|\buct\b/.test(s))                                        return 'UWT';
  if (/cetem/.test(s))                                                   return 'Cetem';
  if (/\brst\s*(noord|north)\b/.test(s))                                 return 'Rst noord';
  if (/\bwht\b/.test(s))                                                 return 'WHT';
  if (/\bbcw\b/.test(s))                                                 return 'Bcw';
  if (/occ\b|overbeek/.test(s))                                          return 'Occ';
  if (/star\s*(container|depot|service)/.test(s))                        return 'Star Container Depot';
  if (/hacon|hacon.*depot/.test(s))                                      return 'HACON CONTAINER DEPOT B.V.';
  if (/hacon.*waalhaven|bunschotenweg.*131/.test(s))                     return 'HACON CONTAINER BV';
  return naam;
}

/**
 * Bekende Steinweg-eigen vestigingen met volledig adres.
 * Key = lowercase zoekpatroon (zonder "steinweg" prefix).
 * Gebruikt door resolveSteinwegLocatie() om naam + adres terug te geven.
 */
const STEINWEG_LOCATIES = [
  // Patroon: [regex,  { naam, adres, postcode, plaats, land }]
  [/\bpier\s*2\b/,          { naam: 'STEINWEG PIER 2',             adres: 'Nijmegenstraat 44',          postcode: '3087 CD', plaats: 'Rotterdam',  land: 'NL' }],
  [/\bpier\s*6\b/,          { naam: 'STEINWEG PIER 6',             adres: 'Zaltbommelstraat 10',        postcode: '3089 KE', plaats: 'Rotterdam',  land: 'NL' }],
  [/beatrix/,               { naam: 'STEINWEG BEATRIX TERMINAL',   adres: 'Den Hamweg Port 2732',       postcode: '3089 KK', plaats: 'Rotterdam',  land: 'NL' }],
  [/benelux/,               { naam: 'STEINWEG BENELUXHAVEN',       adres: 'Elbeweg 101',                postcode: '3198 LC', plaats: 'Europoort',  land: 'NL' }],
  [/parmentier/,            { naam: 'STEINWEG PARMENTIERPLEIN',    adres: 'Parmentierplein 1',          postcode: '3088 GN', plaats: 'Rotterdam',  land: 'NL' }],
  [/botlek/,                { naam: 'STEINWEG BOTLEK TERMINAL BV', adres: 'Professor Gerbrandyweg 17',  postcode: '3197 KK', plaats: 'Rotterdam',  land: 'NL' }],
  [/\bseine(haven)?\b|\btheemsweg\b|\bhandelsveem\b/, { naam: 'STEINWEG SEINEHAVEN', adres: 'Theemsweg 26',            postcode: '3197 KM', plaats: 'Rotterdam',  land: 'NL' }],
  [/spakenburg/,            { naam: 'STEINWEG',                    adres: 'Spakenburgweg 45',           postcode: '3089 KN', plaats: 'Rotterdam',  land: 'NL' }],
];

/**
 * Resolveert een Steinweg-eigen locatienaam naar naam + volledig adres.
 * Doorzoekt STEINWEG_LOCATIES op patroon-match; bij geen match → normaliseer naam + leeg adres.
 */
function resolveSteinwegLocatie(naam) {
  if (!naam) return { naam: '', adres: '', postcode: '', plaats: '', land: 'NL' };
  const s = naam.toLowerCase();
  for (const [re, loc] of STEINWEG_LOCATIES) {
    if (re.test(s)) {
      console.log(`🏭 Steinweg locatie: "${naam}" → ${loc.naam} (${loc.adres})`);
      return { ...loc };
    }
  }
  // Geen match: normaliseer naam, adres onbekend
  const normNaam = naam
    .replace(/^C[.\s]+/i, '')
    .replace(/^steinweg\b/i, 'STEINWEG')
    .replace(/^STEINWEG\s+handelsveem\b/i, 'STEINWEG Handelsveem')
    .trim() || naam;
  console.warn(`⚠️ Steinweg locatie onbekend: "${naam}" → naam="${normNaam}" (geen adres)`);
  return { naam: normNaam, adres: '', postcode: '', plaats: '', land: 'NL' };
}

/** @deprecated — gebruik resolveSteinwegLocatie */
function normSteinwegLocatieNaam(naam) {
  return resolveSteinwegLocatie(naam).naam;
}

function sizetypeToDescription(sizetype) {
  const s = String(sizetype || '').replace(/\s/g, '');
  // Open top: ISO derde karakter = 'U' (bijv. 22U1, 42U1, 45U1)
  if (/^22U/i.test(s)) return '20ft open top';
  if (/^42U/i.test(s)) return '40ft open top';
  if (/^45U/i.test(s)) return '45ft open top';
  // High cube
  if (/^L[25]/.test(s) || /^45/.test(s)) return '45ft HC';
  if (/^L[04]/.test(s)) return '40ft HC';
  // Standaard
  if (/^22/.test(s)) return '20ft';
  if (/^42/.test(s)) return '40ft';
  return s;
}

/**
 * Berekent de eerstvolgende zaterdag ná de route-1 datum.
 * Als route 1 op donderdag of vrijdag valt → zaterdag van de week daarna.
 * Formaat in/uit: "DD-MM-YYYY"
 */
function zaterdagNaRoute1(datum1Str) {
  if (!datum1Str) return '';
  const [dd, mm, yyyy] = datum1Str.split('-').map(Number);
  if (!dd || !mm || !yyyy) return '';
  const d1  = new Date(yyyy, mm - 1, dd);
  const dag = d1.getDay(); // 0=zo, 1=ma, ..., 5=vr, 6=za

  let dagenNaarZat = (6 - dag + 7) % 7;
  if (dagenNaarZat === 0) dagenNaarZat = 7;   // al zaterdag → volgende zaterdag
  if (dag === 4 || dag === 5) dagenNaarZat += 7; // do/vr → week opschuiven

  const zat = new Date(d1);
  zat.setDate(d1.getDate() + dagenNaarZat);
  const resultaat = `${String(zat.getDate()).padStart(2,'0')}-${String(zat.getMonth()+1).padStart(2,'0')}-${zat.getFullYear()}`;
  console.log(`📅 Route 2 zaterdag: route1=${datum1Str} (dag ${dag}) → zat=${resultaat} (+${dagenNaarZat}d)`);
  return resultaat;
}

function selectEarliestFutureDatum(datums) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parsed = datums
    .filter(Boolean)
    .map(d => {
      const [dd, mm, yyyy] = String(d).split('-').map(Number);
      return { str: d, date: new Date(yyyy, mm - 1, dd) };
    })
    .filter(d => d.date >= today)
    .sort((a, b) => a.date - b.date);
  return parsed[0]?.str || datums.find(Boolean) || '';
}

function parseOrdernummer(rows) {
  for (const row of rows.slice(0, 5)) {
    for (const cell of row) {
      const v = String(cell).trim();
      if (/^\d{6,}[\/\-]\d/.test(v)) return v.replace('-', '/');
    }
  }
  // Also check for order number in same row as "PICKUP NOTICE"
  for (const row of rows.slice(0, 5)) {
    const idx = row.findIndex(c => /pickup notice/i.test(String(c)));
    if (idx >= 0) {
      for (let j = idx + 1; j < row.length; j++) {
        const v = String(row[j]).trim();
        if (/\d{6,}/.test(v)) return v.replace('-', '/');
      }
    }
  }
  return '';
}

function parseRoute1(buffer) {
  const rows = parseXlsxBuffer(buffer);
  const ordernummer = parseOrdernummer(rows);
  const fromLoc    = cellAfterLabel(rows, /^From\s*:/i).trim();
  const toLoc      = cellAfterLabel(rows, /^To\s*/i).trim();
  const plannedLoading  =
    parseDatum(cellAfterLabel(rows, /^Planned\s*(Loading|Pickup|ETD|Date)\b/i)) ||
    parseDatum(cellAfterLabel(rows, /^Loading\s*Date/i)) ||
    parseDatum(cellAfterLabel(rows, /^ETA\b/i)) ||
    parseDatum(cellAfterLabel(rows, /^ETD\b/i)) ||
    parseDatum(cellAfterLabel(rows, /^Date\b/i));
  const plannedDelivery = parseDatum(cellAfterLabel(rows, /^Planned\s*Delivery/i));

  const hdrIdx = findHeaderRowIdx(rows);
  if (hdrIdx < 0) return { ordernummer, from: fromLoc, to: toLoc, plannedLoading, plannedDelivery, rederij: '', containers: [] };

  const hdr = rows[hdrIdx].map(h => String(h).trim().toLowerCase());
  const colOf = label => hdr.findIndex(h => h.includes(label.toLowerCase()));

  const cCntr   = colOf('container');
  const cPickup = colOf('pickup ref');
  const cSize   = colOf('sizetype');
  const cWeight = colOf('gross');
  const cProd   = colOf('product');
  const cOrigin = colOf('origin');
  const cImo    = colOf('imo');
  const cZegel  = ['seal number', 'sealnumber', 'seal no', 'seal nr', 'seal#', 'zegel', 'seal']
    .reduce((f, l) => f >= 0 ? f : colOf(l), -1);
  const cShip   = colOf('shipping comp');
  console.log(`🏷️  Route 1 kolomindices: container=${cCntr} pickupRef=${cPickup} sizetype=${cSize} gewicht=${cWeight} seal=${cZegel}`);
  console.log(`🏷️  Route 1 headers: [${hdr.join(' | ')}]`);

  let rederij = '';
  const containers = [];

  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const cntr = String(row[cCntr] ?? '').trim();
    if (!cntr || !/^[A-Z]{4}\d{7}$/i.test(cntr)) continue;

    if (!rederij && cShip >= 0) rederij = String(row[cShip] ?? '').trim();

    containers.push({
      containernummer: cntr,
      pickupRef: cPickup >= 0 ? String(row[cPickup] ?? '').trim() : '',
      sizetype:  cSize   >= 0 ? String(row[cSize]   ?? '').trim() : '',
      gewicht:   cWeight >= 0 ? String(row[cWeight] ?? '').trim() : '',
      lading:    cProd   >= 0 ? String(row[cProd]   ?? '').trim() : '',
      origin:    cOrigin >= 0 ? String(row[cOrigin] ?? '').trim() : '',
      imo:       cImo    >= 0 ? String(row[cImo]    ?? '').trim() : '',
      zegel:     cZegel  >= 0 ? String(row[cZegel]  ?? '').trim() : ''
    });
  }

  console.log(`📋 Route 1: ${containers.length} containers | ${fromLoc} → ${toLoc} | datum ${plannedLoading}`);
  return { ordernummer, from: fromLoc, to: toLoc, plannedLoading, plannedDelivery, rederij, containers };
}

function parseRoute2(buffer) {
  const rows = parseXlsxBuffer(buffer);
  const ordernummer = parseOrdernummer(rows);
  const fromLoc    = cellAfterLabel(rows, /^From\s*:/i).trim();
  const toLoc      = cellAfterLabel(rows, /^To\s*/i).trim();
  const plannedLoading  = parseDatum(cellAfterLabel(rows, /^Planned Loading/i));
  const plannedDelivery = parseDatum(cellAfterLabel(rows, /^Planned Delivery/i));

  const hdrIdx = findHeaderRowIdx(rows);
  if (hdrIdx < 0) return { ordernummer, from: fromLoc, to: toLoc, plannedLoading, plannedDelivery, rederij: '', containers: [] };

  const hdr = rows[hdrIdx].map(h => String(h).trim().toLowerCase());
  const colOf = label => hdr.findIndex(h => h.includes(label.toLowerCase()));

  const cCntr   = colOf('container');
  const cRefDel = colOf('re-delivery ref') >= 0 ? colOf('re-delivery ref') : colOf('delivery ref');
  // Return depot: probeer meerdere kolomnamen
  const cDepot  = (() => {
    for (const label of ['return depot', 're-delivery depot', 'depot', 'return location']) {
      const idx = hdr.findIndex(h => h.includes(label));
      if (idx >= 0) return idx;
    }
    return -1;
  })();
  const cDest   = colOf('destination');
  const cSize   = colOf('sizetype');
  const cShip   = colOf('shipping comp');

  let rederij = '';
  const containers = [];

  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const cntr = String(row[cCntr] ?? '').trim();
    if (!cntr || !/^[A-Z]{4}\d{7}$/i.test(cntr)) continue;

    if (!rederij && cShip >= 0) rederij = String(row[cShip] ?? '').trim();

    const depotRaw = cDepot >= 0 ? String(row[cDepot] ?? '').trim() : '';
    // "(MEDRSMIR) - Medrepair" → depot naam "Medrepair", code "MEDRSMIR"
    const depotNaam = depotRaw.replace(/^\([^)]+\)\s*-\s*/, '').trim() || depotRaw;

    containers.push({
      containernummer: cntr,
      reDeliveryRef: cRefDel >= 0 ? String(row[cRefDel] ?? '').trim() : '',
      returnDepot:   depotNaam,
      destination:   cDest   >= 0 ? String(row[cDest]   ?? '').trim() : '',
      sizetype:      cSize   >= 0 ? String(row[cSize]   ?? '').trim() : ''
    });
  }

  console.log(`📋 Route 2: ${containers.length} containers | ${fromLoc} → ${toLoc} | datum ${plannedLoading}`);
  return { ordernummer, from: fromLoc, to: toLoc, plannedLoading, plannedDelivery, rederij, containers };
}

export default async function parseSteinweg({ route1Buffer, route2Buffer, emailBody, emailSubject }) {
  const r1 = route1Buffer ? parseRoute1(route1Buffer) : null;
  const r2 = route2Buffer ? parseRoute2(route2Buffer) : null;

  const ordernummer = r1?.ordernummer || r2?.ordernummer || '';
  const rederijRaw  = r1?.rederij    || r2?.rederij    || '';

  const afspraken  = await getPrijsafspraken('steinweg');
  // Stop bij aanhef/afsluiting — de rest van de mail is niet relevant voor de opdracht
  const knipBijAfsluiting = s => {
    const m = (s || '').match(/^(.*?)(?:\bmet\s+vriendelijke\s+groet\b|\bkind\s+regards?\b|\bmet\s+vriendelijke\b|\bgroet\b|\bregards\b)/i);
    return m ? m[1].trim() : (s || '').trim();
  };

  const instructies = [emailSubject, emailBody]
    .map(s => knipBijAfsluiting(s))
    .filter(Boolean)
    .join(' | ')
    .replace(/[<>&"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  const results = [];

  // Ordernummer ook uit e-mailonderwerp extraheren (fallback of primaire bron)
  // Patroon: "ORDER/ 62685389/0" of "62685389/0" in het onderwerp
  const orderNrFromSubject = (emailSubject || '')
    .match(/\border[\/\s#]*(\d{6,}[\/\-]\d+)/i)?.[1]?.replace('/', '-')
    || (emailSubject || '').match(/(\d{7,}[\/\-]\d+)/)?.[1]?.replace('/', '-')
    || '';
  const steinwegRef = ordernummer || orderNrFromSubject;
  console.log(`📋 Steinweg referentie: Excel="${ordernummer}" Email="${orderNrFromSubject}" → gebruik="${steinwegRef}"`);

  // ── Route 1: Opzetten (terminal) → Afzetten (Steinweg) — omrijder ──────────
  if (r1 && r1.containers.length > 0) {
    const r1Datum = selectEarliestFutureDatum([r1.plannedLoading, r1.plannedDelivery])
      || parseDateFromSubject(emailSubject);

    for (const c1 of r1.containers) {
      const datum            = r1Datum;
      const containerTypeStr = sizetypeToDescription(c1.sizetype || '2210');
      const gewicht          = String(Math.round(parseFloat(c1.gewicht) || 0));

      // Tariefberekening voor volle container
      const fin     = berekenVolTarief(r1.from, r1.to, containerTypeStr, afspraken);
      const heeftAdr = !!(c1.imo && c1.imo !== '');
      const extra   = calcOrderToeslagen({ tarief: fin.tarief, heeftAdr, heeftGenset: false, heeftGasmeten: false, extraStops: 0 }, afspraken);

      // Omrijder: Opzetten (terminal) → Lossen (OMRIJDER) → Afzetten (Steinweg)
      const locaties = [
        {
          volgorde: '0', actie: 'Opzetten',
          naam: canonicalTerminalNaam(r1.from), adres: '', postcode: '', plaats: '', land: 'NL'
          // geen _noTerminalLookup → terminal-lijst lookup voor portbase_code/bicsCode
        },
        {
          volgorde: '0', actie: 'Lossen',
          naam: 'OMRIJDER', adres: '', postcode: '', plaats: '', land: 'NL'
        },
        (() => {
          const sw = resolveSteinwegLocatie(r1.to);
          return {
            volgorde: '0', actie: 'Afzetten',
            naam: sw.naam, adres: sw.adres, postcode: sw.postcode, plaats: sw.plaats, land: sw.land,
            _noTerminalLookup: true  // Steinweg eigen vestiging — geen haventerminal lookup
          };
        })()
      ];

      results.push(await enrichOrder({
        opdrachtgeverNaam:     'STEINWEG',
        opdrachtgeverAdres:    'Parmentierplein 1',
        opdrachtgeverPostcode: '3088 GN',
        opdrachtgeverPlaats:   'Rotterdam',
        opdrachtgeverTelefoon: '',
        opdrachtgeverEmail:    'Trucking@nl.steinweg.com',
        opdrachtgeverBTW:      'NL001853843B01',
        opdrachtgeverKVK:      '24001123',
        klantnaam:     'STEINWEG',
        klantadres:    '',
        klantpostcode: '',
        klantplaats:   '',
        ritnummer:      steinwegRef,
        bootnaam:       '',
        rederijRaw,
        rederij:        '',
        inleverBootnaam: '',
        inleverRederij:  '',
        containernummer:   c1.containernummer,
        containertype:     containerTypeStr,
        zegel:          c1.zegel   || '',
        colli:          '0',
        lading:         (c1.lading || '').toUpperCase(),
        brutogewicht:   gewicht,
        geladenGewicht: '0',
        cbm:            '0',
        datum,
        tijd: '',
        referentie:        c1.pickupRef || '',   // terminal pickup ref
        laadreferentie:    '',
        inleverreferentie: steinwegRef,           // referentie bij Steinweg afzetten
        inleverBestemming: '',
        adr:           heeftAdr ? 'Waar' : 'Onwaar',
        ladenOfLossen: 'Lossen',
        instructies,
        tar: '', documentatie: '', tarra: '0', brix: '0',
        // Financieel
        tarief:              fin.tarief,
        dieselToeslagChart:  fin.dieselToeslagChart,
        deltaChart:          fin.deltaChart,
        euromaxChart:        fin.euromaxChart,
        blanco1Chart:        fin.blanco1Chart,
        blanco1Text:         fin.blanco1Text,
        blanco2Chart:        fin.blanco2Chart,
        blanco2Text:         fin.blanco2Text,
        botlekChart:         fin.botlekChart       ?? 0,
        adrToeslagChart:     extra.adrToeslagChart,
        adrBedragChart:      extra.adrBedragChart,
        genChart:            extra.genChart,
        gasMetenChart:       extra.gasMetenChart,
        extraStopChart:      extra.extraStopChart,
        locaties
      }, { bron: 'Steinweg' }));
    }
  }

  // ── Route 2: Opzetten (Steinweg) → Afzetten (return depot) — omrijder ───────
  // Altijd apart verwerken — ook als route 1 aanwezig is
  if (r2 && r2.containers.length > 0) {
    // Datum route 2 = altijd de zaterdag NA route 1
    // Als route 1 op do/vr → zaterdag van de week daarna
    const r1DatumVoorR2 = r1
      ? (selectEarliestFutureDatum([r1.plannedLoading, r1.plannedDelivery]) || parseDateFromSubject(emailSubject))
      : '';
    const r2Datum = zaterdagNaRoute1(r1DatumVoorR2)
      || selectEarliestFutureDatum([r2.plannedLoading, r2.plannedDelivery])
      || parseDateFromSubject(emailSubject);

    // Bereken welke containers in een setje (pair) rijden
    const pairedSet = berekenPairs(r2.containers, c => sizetypeToDescription(c.sizetype || '2210'));
    console.log(`🔗 Route 2 pairs (${pairedSet.size}/${r2.containers.length}):`, [...pairedSet]);

    for (const c2 of r2.containers) {
      const datum            = r2Datum;
      const containerTypeStr = sizetypeToDescription(c2.sizetype || '2210');
      const isPaired         = pairedSet.has(c2.containernummer);

      // Tariefberekening voor lege container
      const fin = berekenLeegTarief(
        c2.returnDepot || c2.destination || '',
        r2.from,
        containerTypeStr,
        isPaired,
        afspraken
      );

      // Adres ophalen voor return depot uit steinweg_adressen.json.
      // Voor haven-terminals (RWG/ECT/EuroMax/...) NIET: die moeten via de
      // normale haventerminal-lookup (op_afzetten.json) hun portbase/bics
      // krijgen — anders verschijnt RWG als "nieuwe terminal" in EasyTrip.
      const depotRawNaam = canonicalTerminalNaam(c2.returnDepot || c2.destination || '');
      const isHavenTerminal = HAVEN_TERMINALS.has(depotRawNaam);
      const depotInfo    = depotRawNaam
        ? (isHavenTerminal
            ? { naam: depotRawNaam, adres: '', postcode: '', plaats: '', land: 'NL', _isHavenTerminal: true }
            : (await getSteinwegAdres(depotRawNaam) || { naam: depotRawNaam, adres: '', postcode: '', plaats: '', land: 'NL' }))
        : { naam: '', adres: '', postcode: '', plaats: '', land: 'NL' };

      // Omrijder: Opzetten (Steinweg) → Lossen (OMRIJDER) → Afzetten (return depot)
      const locaties = [
        (() => {
          const sw = resolveSteinwegLocatie(r2.from);
          return {
            volgorde: '0', actie: 'Opzetten',
            naam: sw.naam, adres: sw.adres, postcode: sw.postcode, plaats: sw.plaats, land: sw.land,
            _noTerminalLookup: true  // Steinweg eigen vestiging — geen haventerminal lookup
          };
        })(),
        {
          volgorde: '0', actie: 'Lossen',
          naam: 'OMRIJDER', adres: '', postcode: '', plaats: '', land: 'NL'
        },
        {
          volgorde: '0', actie: 'Afzetten',
          naam: depotInfo.naam, adres: depotInfo.adres, postcode: depotInfo.postcode,
          plaats: depotInfo.plaats, land: depotInfo.land,
          // Bij een echte haven-terminal (RWG/ECT/...) NIET noTerminalLookup
          // → generateXml doet dan de normale lookup en zet portbase/bics erin.
          ...(depotInfo._isHavenTerminal ? {} : { _noTerminalLookup: true }),
        }
      ];

      results.push(await enrichOrder({
        opdrachtgeverNaam:     'STEINWEG',
        opdrachtgeverAdres:    'Parmentierplein 1',
        opdrachtgeverPostcode: '3088 GN',
        opdrachtgeverPlaats:   'Rotterdam',
        opdrachtgeverTelefoon: '',
        opdrachtgeverEmail:    'Trucking@nl.steinweg.com',
        opdrachtgeverBTW:      'NL001853843B01',
        opdrachtgeverKVK:      '24001123',
        klantnaam:     'STEINWEG',
        klantadres:    '',
        klantpostcode: '',
        klantplaats:   '',
        ritnummer:      steinwegRef,
        bootnaam:       '',
        rederijRaw,
        rederij:        '',
        inleverBootnaam: '',
        inleverRederij:  '',
        containernummer:   c2.containernummer,
        containertype:     containerTypeStr,
        zegel: '', colli: '0', lading: '',
        brutogewicht: '0', geladenGewicht: '0', cbm: '0',
        datum,
        tijd: '',
        referentie:        steinwegRef,          // referentie bij Steinweg opzetten
        laadreferentie:    '',
        inleverreferentie: c2.reDeliveryRef || '',  // referentie bij depot afzetten
        inleverBestemming: c2.returnDepot   || '',
        adr: 'Onwaar',
        ladenOfLossen: 'Lossen',
        instructies,
        tar: '', documentatie: '', tarra: '0', brix: '0',
        // Financieel (lege containers hebben geen ADR/genset/gasmeten)
        tarief:              fin.tarief,
        dieselToeslagChart:  fin.dieselToeslagChart,
        deltaChart:          fin.deltaChart,
        euromaxChart:        fin.euromaxChart,
        blanco1Chart:        fin.blanco1Chart,
        blanco1Text:         fin.blanco1Text,
        blanco2Chart:        fin.blanco2Chart,
        blanco2Text:         fin.blanco2Text,
        botlekChart:         fin.botlekChart       ?? 0,
        adrToeslagChart:     0,
        adrBedragChart:      0,
        genChart:            0,
        gasMetenChart:       0,
        extraStopChart:      0,
        locaties
      }, { bron: 'Steinweg' }));
    }
  }

  console.log(`✅ parseSteinweg: ${results.length} container(s)`);
  return results;
}
