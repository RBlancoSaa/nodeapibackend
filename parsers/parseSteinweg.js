// 📁 parsers/parseSteinweg.js
import '../utils/fsPatch.js';
import XLSX from 'xlsx';
import { getKlantData } from '../utils/lookups/terminalLookup.js';
import { enrichOrder } from '../utils/enrichOrder.js';
import { berekenVolTarief, berekenLeegTarief, berekenPairs } from '../utils/steinwegTarieven.js';

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
 * Normaliseert terminalnamen uit het Steinweg Excel-bestand naar de exacte namen
 * zoals ze in de terminal-lijst (op_afzetten.json) staan.
 * Hierdoor vindt enrichOrder de juiste BICS/portbase-codes.
 *
 * LET OP: Steinweg-eigen adressen worden NIET genormaliseerd — de ruwe naam
 * uit het Excel-bestand wordt doorgegeven zodat het juiste Steinweg-adres
 * (Spakenburgweg, Parmentierplein, Beatrix, Botlek etc.) behouden blijft.
 */
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
  if (/dcs kramer|kramer.*delta|qterminals.*kramer/.test(s))             return 'DCS Kramer Group';
  if (/medrepair|med repair/.test(s))                                    return 'MedRepair';
  if (/van\s*doorn/.test(s))                                             return 'VAN DOORN';
  if (/\buwt\b|\buct\b/.test(s))                                        return 'UWT';
  if (/cetem/.test(s))                                                   return 'Cetem';
  // ── Steinweg-vestigingen ─────────────────────────────────────────────
  // Alleen bedrijfsreferenties matchen, GEEN generieke "steinweg"-straatnamen.
  // Volgorde: specifiek → algemeen.
  if (/steinweg.*botlek|gerbrandyweg/.test(s))                             return 'STEINWEG BOTLEK TERMINAL BV';
  if (/steinweg.*beatrix|den hamweg.*port/.test(s))                        return 'STEINWEG BEATRIX TERMINAL';
  // Duidelijke bedrijfsnaam-varianten (met "c. steinweg" of bekende locatie):
  if (/^c[\s.]?\s*steinweg/.test(s))                                       return 'STEINWEG';
  if (/steinweg\s*(handelsveem|parmentier|sluijsdijk|seine|spakenburgweg|waalhaven|heijplaat)/.test(s)) return 'STEINWEG';
  // Generiek "steinweg" als zelfstandig woord aan het begin → firma-referentie
  if (/^steinweg\b(?!straat|weg|laan|plein\s*\d)/.test(s))                return 'STEINWEG';
  return naam;
}

function sizetypeToDescription(sizetype) {
  const s = String(sizetype || '').replace(/\s/g, '');
  if (/^22/.test(s)) return '20ft';
  if (/^42/.test(s)) return '40ft';
  if (/^L[25]/.test(s) || /^45/.test(s)) return '45ft HC';
  if (/^L[04]/.test(s)) return '40ft HC';
  return s;
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
      if (/^\d{6,}[\/\-]\d/.test(v)) return v.replace('/', '-');
    }
  }
  // Also check for order number in same row as "PICKUP NOTICE"
  for (const row of rows.slice(0, 5)) {
    const idx = row.findIndex(c => /pickup notice/i.test(String(c)));
    if (idx >= 0) {
      for (let j = idx + 1; j < row.length; j++) {
        const v = String(row[j]).trim();
        if (/\d{6,}/.test(v)) return v.replace('/', '-');
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
  const cZegel  = ['zegel', 'seal nr', 'seal no', 'seal'].reduce((f, l) => f >= 0 ? f : colOf(l), -1);
  const cShip   = colOf('shipping comp');

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

  const klant = await getKlantData('steinweg');
  const instructies = [emailSubject, emailBody]
    .map(s => (s || '').trim())
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
      const fin = berekenVolTarief(r1.from, r1.to, containerTypeStr);

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
        {
          volgorde: '0', actie: 'Afzetten',
          // Steinweg eigen vestiging — GEEN haventerminal, adres NIET overschrijven
          naam: canonicalTerminalNaam(r1.to), adres: '', postcode: '', plaats: '', land: 'NL',
          _noTerminalLookup: true
        }
      ];

      results.push(await enrichOrder({
        opdrachtgeverNaam:     'STEINWEG',
        opdrachtgeverAdres:    klant?.adres    || '',
        opdrachtgeverPostcode: klant?.postcode || '',
        opdrachtgeverPlaats:   klant?.plaats   || '',
        opdrachtgeverTelefoon: klant?.telefoon || '',
        opdrachtgeverEmail:    klant?.email    || '',
        opdrachtgeverBTW:      klant?.btw      || '',
        opdrachtgeverKVK:      klant?.kvk      || '',
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
        adr:           c1.imo && c1.imo !== '' ? 'Waar' : 'Onwaar',
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
        locaties
      }, { bron: 'Steinweg' }));
    }
  }

  // ── Route 2: Opzetten (Steinweg) → Afzetten (return depot) — omrijder ───────
  // Altijd apart verwerken — ook als route 1 aanwezig is
  if (r2 && r2.containers.length > 0) {
    const r2Datum = selectEarliestFutureDatum([r2.plannedLoading, r2.plannedDelivery])
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
        isPaired
      );

      // Omrijder: Opzetten (Steinweg) → Lossen (OMRIJDER) → Afzetten (return depot)
      const locaties = [
        {
          volgorde: '0', actie: 'Opzetten',
          // Steinweg eigen vestiging — GEEN haventerminal, adres NIET overschrijven
          naam: canonicalTerminalNaam(r2.from), adres: '', postcode: '', plaats: '', land: 'NL',
          _noTerminalLookup: true
        },
        {
          volgorde: '0', actie: 'Lossen',
          naam: 'OMRIJDER', adres: '', postcode: '', plaats: '', land: 'NL'
        },
        {
          volgorde: '0', actie: 'Afzetten',
          // Return depot → terminal-lijst lookup voor portbase_code/bicsCode
          naam: canonicalTerminalNaam(c2.returnDepot || c2.destination || ''),
          adres: '', postcode: '', plaats: '', land: 'NL'
        }
      ];

      results.push(await enrichOrder({
        opdrachtgeverNaam:     'STEINWEG',
        opdrachtgeverAdres:    klant?.adres    || '',
        opdrachtgeverPostcode: klant?.postcode || '',
        opdrachtgeverPlaats:   klant?.plaats   || '',
        opdrachtgeverTelefoon: klant?.telefoon || '',
        opdrachtgeverEmail:    klant?.email    || '',
        opdrachtgeverBTW:      klant?.btw      || '',
        opdrachtgeverKVK:      klant?.kvk      || '',
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
        // Financieel
        tarief:              fin.tarief,
        dieselToeslagChart:  fin.dieselToeslagChart,
        deltaChart:          fin.deltaChart,
        euromaxChart:        fin.euromaxChart,
        blanco1Chart:        fin.blanco1Chart,
        blanco1Text:         fin.blanco1Text,
        blanco2Chart:        fin.blanco2Chart,
        blanco2Text:         fin.blanco2Text,
        locaties
      }, { bron: 'Steinweg' }));
    }
  }

  console.log(`✅ parseSteinweg: ${results.length} container(s)`);
  return results;
}
