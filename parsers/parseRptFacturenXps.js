// parsers/parseRptFacturenXps.js
//
// Parser voor het XPS-factuurarchief (rptFacturen.xps) — een gebundeld
// rapport van Tiaro Transport waarin elke pagina één factuur bevat.
//
// XPS = XML Paper Specification: een ZIP-bestand met UTF-16 XML pages
// in /Documents/1/Pages/{n}.fpage. Elke <Glyphs> heeft een UnicodeString
// attribuut met de werkelijke tekst.
//
// Output:
//   {
//     totaalFacturen, totaalRegels, totaalToeslagen,
//     topToeslagtypes: [{naam, count, avgBedrag}],
//     facturen: [{
//       paginanummer, factuurnummer, klant, factuurdatum,
//       btwNummerKlant, dossiernummer, totaal,
//       regels: [{
//         datum, onsRitnr, uwRitnr, container, containertype,
//         routeRuw, btwPerc, basisTarief, totaalRit,
//         toeslagen: [{omschrijving, btwPerc, bedrag}]
//       }]
//     }]
//   }

import AdmZip from 'adm-zip';

const NL_MOUNTH = {
  jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12,
};

const RE_RIT = new RegExp(
  '^(\\d{1,2}-(?:[a-z]{3}|\\d{1,2}))\\s+'   // datum
  + '(\\d{4,6})\\s+'                          // ons ritnr
  + '(\\S+)\\s+'                              // uw ritnr
  + '(\\S+)\\s+'                              // container
  + '(.+?)\\s+'                               // route
  + '(\\d)\\s+€\\s*([\\-\\d.,]+)\\s*$'        // btw + bedrag
);
const RE_TOESLAG    = /^([A-Za-zÀ-ÿ][^€]*?)\s+(\d)\s+€\s*([\-\d.,]+)\s*$/;
const RE_BEDRAG_ALONE = /^([\-\d.,]+)\s*$/;
const RE_FACTUUR    = /Factuurnummer\s+(\d{6,})/;
const RE_FACTDATUM  = /Datum\s+(\d{1,2}-\d{1,2}-\d{4})/;
const RE_BTWNR      = /Uw BTW-nummer\s+([A-Z0-9]+)/;
const RE_DOSSIER    = /Dossiernummer\s+(\d+)/;
const RE_TOTAAL     = /^Totaal\s+€\s*([\-\d.,]+)/;
const RE_GLYPHS     = /OriginX="([\d.\-]+)"\s+OriginY="([\d.\-]+)"\s+UnicodeString="([^"]*)"/g;
const RE_CTYPE      = /^\d{2,3}[A-Z]\d/;

const SKIP_KEYWORDS = [
  'Bij deze verzoeken', 'Algemene Vervoerscondities', 'CMR-verdrag',
  'zeecontainervervoervoorwaarden', 'griffe van', 'Subtotaal', 'BTW:',
  'Pagina', 'Vervaldatum', 'Telefoonnummer', 'SWIFT', 'IBAN', 'KvK',
];

function parseBedrag(s) {
  if (s === null || s === undefined) return null;
  s = String(s).replace(/\./g, '').replace(/,/g, '.').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseNlDate(s, jaarFallback = null) {
  if (!s) return null;
  s = s.toLowerCase().trim();
  let m = s.match(/^(\d{1,2})-([a-z]{3})$/);
  if (m && jaarFallback) {
    const d = parseInt(m[1], 10);
    const mn = NL_MOUNTH[m[2]];
    if (mn) return `${jaarFallback}-${String(mn).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m && jaarFallback) {
    return `${jaarFallback}-${String(parseInt(m[2], 10)).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) {
    return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
  }
  return null;
}

function isSkipLine(ln) {
  return SKIP_KEYWORDS.some(kw => ln.includes(kw));
}

// Lees één .fpage en bouw lijst van regels op door op Y-coordinaat te clusteren
function pageBufferToLines(buf) {
  // XPS pages zijn UTF-16 LE (mét BOM). Probeer eerst UTF-16, val terug op UTF-8.
  let text;
  try {
    text = buf.toString('utf16le');
  } catch (e) {
    text = buf.toString('utf-8');
  }

  const items = []; // { y, x, s }
  RE_GLYPHS.lastIndex = 0;
  let m;
  while ((m = RE_GLYPHS.exec(text)) !== null) {
    items.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), s: m[3] });
  }
  // Sorteer op rij (Y-bucket op ~3pt) dan op X
  items.sort((a, b) => {
    const ay = Math.round(a.y / 3);
    const by = Math.round(b.y / 3);
    if (ay !== by) return ay - by;
    return a.x - b.x;
  });

  const lines = [];
  let curY = null, cur = [];
  for (const it of items) {
    if (curY === null || Math.abs(it.y - curY) > 3) {
      if (cur.length) lines.push(cur.join(' '));
      cur = [it.s]; curY = it.y;
    } else {
      cur.push(it.s);
    }
  }
  if (cur.length) lines.push(cur.join(' '));
  return lines;
}

function parsePage(lines, paginanummer) {
  const f = {
    paginanummer,
    factuurnummer: null,
    klant: null,
    factuurdatum: null,
    btwNummerKlant: null,
    dossiernummer: null,
    totaal: null,
    regels: [],
  };

  // Header
  for (const ln of lines) {
    if (!f.factuurnummer)   { const m = ln.match(RE_FACTUUR);   if (m) f.factuurnummer = m[1]; }
    if (!f.factuurdatum)    { const m = ln.match(RE_FACTDATUM); if (m) f.factuurdatum = parseNlDate(m[1]); }
    if (!f.btwNummerKlant)  { const m = ln.match(RE_BTWNR);     if (m) f.btwNummerKlant = m[1]; }
    if (!f.dossiernummer)   { const m = ln.match(RE_DOSSIER);   if (m) f.dossiernummer = m[1]; }
    if (f.totaal === null)  { const m = ln.match(RE_TOTAAL);    if (m) f.totaal = parseBedrag(m[1]); }
  }

  // Klant: regel vóór "Telefoonnummer"
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Telefoonnummer') && i >= 2) { f.klant = lines[i - 1].trim(); break; }
  }
  if (!f.klant && lines.length > 2) f.klant = lines[2].trim();

  const factJaar = f.factuurdatum ? f.factuurdatum.slice(0, 4) : null;

  // Regels — alleen tussen tabel-header en Subtotaal
  let inTable = false;
  let curRit = null;
  for (const lnRaw of lines) {
    const s = lnRaw.trim();
    if (s.includes('Datum Ons') || s.includes('Omschrijving BTW Bedrag')) {
      inTable = true; continue;
    }
    if (s.includes('Subtotaal') || s.startsWith('BTW:') || s.startsWith('Totaal ')) {
      if (curRit) { f.regels.push(curRit); curRit = null; }
      inTable = false; continue;
    }
    if (!inTable || isSkipLine(s) || !s) continue;

    const mRit = s.match(RE_RIT);
    if (mRit) {
      if (curRit) f.regels.push(curRit);
      curRit = {
        datum: parseNlDate(mRit[1], factJaar),
        onsRitnr: mRit[2],
        uwRitnr: mRit[3],
        container: mRit[4],
        routeRuw: mRit[5].trim(),
        btwPerc: parseInt(mRit[6], 10),
        basisTarief: parseBedrag(mRit[7]),
        containertype: null,
        toeslagen: [],
        totaalRit: null,
      };
      continue;
    }
    if (curRit && RE_CTYPE.test(s)) {
      curRit.containertype = s.split(/\s+/)[0];
      continue;
    }
    if (curRit && RE_BEDRAG_ALONE.test(s)) {
      curRit.totaalRit = parseBedrag(s);
      continue;
    }
    const mT = s.match(RE_TOESLAG);
    if (mT && curRit) {
      const oms = mT[1].trim();
      // skip als omschrijving uniform UPPERCASE en geen letters (hoogst ongebruikelijk; voorkomt referentienr-matches)
      if (oms.toUpperCase() !== oms || /[a-z]/.test(oms)) {
        curRit.toeslagen.push({
          omschrijving: oms,
          btwPerc: parseInt(mT[2], 10),
          bedrag: parseBedrag(mT[3]),
        });
      }
      continue;
    }
  }
  if (curRit) f.regels.push(curRit);
  return f;
}

// Normaliseer toeslag-omschrijving voor groepering
export function normaliseerToeslag(omschrijving) {
  if (!omschrijving) return '';
  let n = omschrijving.toLowerCase().trim();
  n = n.replace(/\s*\([^)]+\)\s*/g, ' ');     // strip "(11%)"
  n = n.replace(/\s+\d+([,.]\d+)?\s*%?\s*$/, ''); // strip percentages aan eind
  n = n.replace(/\s+/g, ' ').trim();
  // Spelfouten normaliseren — observed in dataset
  n = n.replace(/^rwg\s*toe(s|l)?(a|s|al|alg)g$/, 'rwg toeslag');
  return n;
}

/**
 * Parseer een rptFacturen.xps Buffer.
 * @param {Buffer} buffer .xps bestand
 * @returns {object} { totaalFacturen, totaalRegels, totaalToeslagen, topToeslagtypes, facturen }
 */
export function parseRptFacturenXps(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries()
    .filter(e => /^Documents\/1\/Pages\/\d+\.fpage$/.test(e.entryName))
    .sort((a, b) => {
      const ai = parseInt(a.entryName.match(/(\d+)\.fpage$/)[1], 10);
      const bi = parseInt(b.entryName.match(/(\d+)\.fpage$/)[1], 10);
      return ai - bi;
    });

  if (!entries.length) {
    throw new Error('XPS bestand bevat geen pagina\'s (geen Documents/1/Pages/*.fpage gevonden)');
  }

  const facturen = [];
  for (const e of entries) {
    const num = parseInt(e.entryName.match(/(\d+)\.fpage$/)[1], 10);
    try {
      const lines = pageBufferToLines(e.getData());
      const f = parsePage(lines, num);
      if (f.factuurnummer) facturen.push(f);
    } catch (err) {
      // Ga door — pagina's zonder factuurnr negeren we
    }
  }

  // Aggregeer toeslag-statistieken
  const toeslagFreq = new Map();
  let regelTotal = 0, toeslagTotal = 0;
  for (const f of facturen) {
    regelTotal += f.regels.length;
    for (const r of f.regels) {
      for (const t of r.toeslagen) {
        toeslagTotal++;
        const key = normaliseerToeslag(t.omschrijving);
        if (!toeslagFreq.has(key)) toeslagFreq.set(key, { count: 0, sum: 0 });
        const v = toeslagFreq.get(key);
        v.count++;
        if (t.bedrag) v.sum += t.bedrag;
      }
    }
  }
  const topToeslagtypes = [...toeslagFreq.entries()]
    .map(([naam, { count, sum }]) => ({ naam, count, avgBedrag: count ? sum / count : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  return {
    totaalFacturen: facturen.length,
    totaalRegels: regelTotal,
    totaalToeslagen: toeslagTotal,
    topToeslagtypes,
    facturen,
  };
}

// Map een toeslag-naam naar een toeslagkolom (voor factuur_regels) of naar overige_toeslagen
export function toeslagNaarKolom(omsNorm) {
  if (!omsNorm) return null;
  const n = omsNorm.toLowerCase();
  if (n.includes('dieseltoeslag') || n.includes('diesel toeslag') || n === 'diesel') return 'diesel_toeslag';
  if (n.includes('delta-toeslag') || n.includes('delta toeslag') || n === 'delta') return 'delta_toeslag';
  if (n === 'rwg toeslag' || n === 'rwg' || n.includes('rwg-toeslag')) return 'rwg_toeslag';
  if (n.includes('congestie')) return 'congestie_toeslag';
  if (n.includes('adr')) return 'adr_toeslag';
  if (n.includes('wachtuur') || n.includes('wachturen')) return 'wachtuur_toeslag';
  if (n.includes('chassishuur') || n.includes('chassis huur')) return 'chassishuur';
  return null; // → overige_toeslagen
}
