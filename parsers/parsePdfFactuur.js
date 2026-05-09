// parsers/parsePdfFactuur.js
//
// Parser voor losse factuur-PDFs (één factuur per bestand).
// Output is gelijkvormig aan parseRptFacturenXps zodat het auto-detect
// endpoint dezelfde DB-tabellen kan vullen.
//
// Werkt op de Tiaro factuur-layout — zelfde structuur als de XPS-pagina's:
//   header met Factuurnummer / Datum / Uw BTW-nummer / Dossiernummer
//   tabel met "Datum  Ons ritnr  Uw ritnr  Container  Opzet  Bestemming  Afzet  BTW  €"
//   gevolgd door toeslag-regels en een totaal-rit-regel
//
// Returnt: { factuur: { ... regels: [...] } }
// (één object, niet een array — er is maar één factuur per PDF)

import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { normaliseerToeslag, toeslagNaarKolom } from './parseRptFacturenXps.js';

const NL_MOUNTH = {
  jan: 1, feb: 2, mrt: 3, apr: 4, mei: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12,
};

const RE_RIT = new RegExp(
  '^(\\d{1,2}-(?:[a-z]{3}|\\d{1,2}))\\s+'
  + '(\\d{4,6})\\s+'
  + '(\\S+)\\s+'
  + '(\\S+)\\s+'
  + '(.+?)\\s+'
  + '(\\d)\\s+€\\s*([\\-\\d.,]+)\\s*$'
);
const RE_TOESLAG    = /^([A-Za-zÀ-ÿ][^€]*?)\s+(\d)\s+€\s*([\-\d.,]+)\s*$/;
const RE_BEDRAG_ALONE = /^([\-\d.,]+)\s*$/;
const RE_FACTUUR    = /Factuurnummer\s+(\d{6,})/;
const RE_FACTDATUM  = /Datum\s+(\d{1,2}-\d{1,2}-\d{4})/;
const RE_BTWNR      = /Uw BTW-nummer\s+([A-Z0-9]+)/;
const RE_DOSSIER    = /Dossiernummer\s+(\d+)/;
const RE_TOTAAL     = /^Totaal\s+€\s*([\-\d.,]+)/;
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
    const d = parseInt(m[1], 10); const mn = NL_MOUNTH[m[2]];
    if (mn) return `${jaarFallback}-${String(mn).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
  return null;
}
function isSkipLine(ln) { return SKIP_KEYWORDS.some(kw => ln.includes(kw)); }

function parseLines(lines) {
  const f = {
    factuurnummer: null, klant: null, factuurdatum: null,
    btwNummerKlant: null, dossiernummer: null, totaal: null, regels: [],
  };
  for (const ln of lines) {
    if (!f.factuurnummer)   { const m = ln.match(RE_FACTUUR);   if (m) f.factuurnummer = m[1]; }
    if (!f.factuurdatum)    { const m = ln.match(RE_FACTDATUM); if (m) f.factuurdatum = parseNlDate(m[1]); }
    if (!f.btwNummerKlant)  { const m = ln.match(RE_BTWNR);     if (m) f.btwNummerKlant = m[1]; }
    if (!f.dossiernummer)   { const m = ln.match(RE_DOSSIER);   if (m) f.dossiernummer = m[1]; }
    if (f.totaal === null)  { const m = ln.match(RE_TOTAAL);    if (m) f.totaal = parseBedrag(m[1]); }
  }
  // Klant heuristiek: regel vóór "Telefoonnummer"
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Telefoonnummer') && i >= 2) { f.klant = lines[i - 1].trim(); break; }
  }

  const factJaar = f.factuurdatum ? f.factuurdatum.slice(0, 4) : null;
  let inTable = false;
  let curRit = null;
  for (const lnRaw of lines) {
    const s = lnRaw.trim();
    if (s.includes('Datum Ons') || s.includes('Omschrijving BTW Bedrag')) { inTable = true; continue; }
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
        onsRitnr: mRit[2], uwRitnr: mRit[3], container: mRit[4],
        routeRuw: mRit[5].trim(), btwPerc: parseInt(mRit[6], 10),
        basisTarief: parseBedrag(mRit[7]),
        containertype: null, toeslagen: [], totaalRit: null,
      };
      continue;
    }
    if (curRit && RE_CTYPE.test(s)) { curRit.containertype = s.split(/\s+/)[0]; continue; }
    if (curRit && RE_BEDRAG_ALONE.test(s)) { curRit.totaalRit = parseBedrag(s); continue; }
    const mT = s.match(RE_TOESLAG);
    if (mT && curRit) {
      curRit.toeslagen.push({
        omschrijving: mT[1].trim(),
        btwPerc: parseInt(mT[2], 10),
        bedrag: parseBedrag(mT[3]),
      });
    }
  }
  if (curRit) f.regels.push(curRit);
  return f;
}

/**
 * Parseer een losse factuur-PDF.
 * @param {Buffer} buffer
 * @returns {Promise<object>} { factuur: {factuurnummer, klant, ..., regels: [{...}]} }
 */
export async function parsePdfFactuur(buffer) {
  const pdf = await pdfParse(buffer);
  // Splits op newlines — pdf-parse geeft door regelovergangen heen, maar
  // de Tiaro-layout heeft één regel per "lijn". Soms zitten meerdere
  // glyphs op één regel — we proberen op meerdere mogelijkheden.
  const lines = pdf.text
    .split(/\r?\n+/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const f = parseLines(lines);
  return { factuur: f, ruwe_regels_count: lines.length };
}

/**
 * Match een geparseerde factuur tegen bestaande prijsafspraken.
 * Detecteert afwijkingen tussen verwachte basis en gefactureerde basis.
 *
 * @param {object} factuur (uit parsePdfFactuur)
 * @param {function} prijsafspraakLookup async (klant, route, containertype) => verwacht_tarief|null
 * @returns {Promise<Array>} alerts: [{ regel, verwacht, gefactureerd, verschil }]
 */
export async function detecteerAfwijkingen(factuur, prijsafspraakLookup) {
  if (!factuur || !factuur.regels) return [];
  const alerts = [];
  for (const r of factuur.regels) {
    const verwacht = await prijsafspraakLookup(factuur.klant, r.routeRuw, r.containertype);
    if (verwacht !== null && verwacht !== undefined && r.basisTarief !== null) {
      const verschil = r.basisTarief - verwacht;
      const drempel = Math.max(5, verwacht * 0.05);
      if (Math.abs(verschil) > drempel) {
        alerts.push({
          regel: r,
          verwacht,
          gefactureerd: r.basisTarief,
          verschil,
          relatief: verwacht ? (verschil / verwacht) : null,
        });
      }
    }
  }
  return alerts;
}

// Re-export voor consistentie met XPS-parser
export { normaliseerToeslag, toeslagNaarKolom };
