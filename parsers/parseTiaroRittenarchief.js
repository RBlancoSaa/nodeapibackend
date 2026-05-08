// parsers/parseTiaroRittenarchief.js
//
// Parser voor het Tiaro rittenarchief (oudedata.xlsx).
// 45 kolommen, één rij per rit, met Omzet/Inkoop/Charter/Datum/Klant/etc.
//
// Mapt naar het bestaande historische_ritten schema, met extra velden in `raw`.

import XLSX from 'xlsx';

function parseExcelDatum(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  // Bv "2026-05-04 00:00:00"
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m; if (y.length === 2) y = '20' + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[€$£\s]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bool(v) {
  if (v === null || v === undefined || v === '') return false;
  const s = String(v).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'ja' || s === 'yes' || s === 'waar';
}

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Parseer een Tiaro rittenarchief Excel-bestand.
 * @param {Buffer} buffer
 * @param {object} opts
 * @returns {object} { totaalRijen, klantStats, rijen: [...] }
 */
export function parseTiaroRittenarchief(buffer, opts = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = opts.sheetName || wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (!rows.length) {
    return { error: 'Lege sheet', rijen: [], totaalRijen: 0 };
  }
  const headers = rows[0].map(h => String(h || '').trim());
  const data = rows.slice(1);

  // Header → index map (case-insensitive substring match)
  function colIdx(...alts) {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (alts.some(a => h === a.toLowerCase() || h.includes(a.toLowerCase()))) return i;
    }
    return -1;
  }

  const idx = {
    datum: colIdx('Datum'),
    klant: colIdx('Klant'),
    refKlant: colIdx('Ref klant'),
    charter: colIdx('Charter'),
    uitgevoerdDoor: colIdx('Uitgevoerd door'),
    container: colIdx('Container'),
    containertype: colIdx('Containertype'),
    lading: colIdx('Lading'),
    adr: colIdx('ADR'),
    brutogewicht: colIdx('Brutogewicht'),
    geladen: colIdx('Geladen gewicht'),
    opzetterminal: colIdx('Opzetterminal'),
    afzetterminal: colIdx('Afzetterminal'),
    laadlosbedrijf: colIdx('Laad-losbedrijf', 'Laadlosbedrijf'),
    laadlosplaats: colIdx('Laad-losplaats', 'Laadlosplaats'),
    laadlosref: colIdx('Laad-losref', 'Laadlosref'),
    rederij: colIdx('Rederij'),
    bootnaam: colIdx('Bootnaam'),
    omzet: colIdx('Omzet'),
    inkoop: colIdx('Inkoop'),
    btw: colIdx('BTW'),
    btwCharter: colIdx('BTW charter'),
    derden: colIdx('Derden'),
    resultaat: colIdx('Resultaat'),
    laadOfLossen: colIdx('Laden of lossen'),
    id: colIdx('ID'),
  };

  const klantStats = new Map();
  const rijen = [];

  for (const r of data) {
    const klantRaw = str(r[idx.klant]);
    if (!klantRaw) continue;
    const klant = klantRaw.toLowerCase();
    const datum = parseExcelDatum(r[idx.datum]);
    const omzet = num(r[idx.omzet]);
    const inkoop = num(r[idx.inkoop]);
    const isLaden = (str(r[idx.laadOfLossen]) || '').toLowerCase().startsWith('laden');

    const opzet = str(r[idx.opzetterminal]);
    const afzet = str(r[idx.afzetterminal]);
    const lbedrijf = str(r[idx.laadlosbedrijf]);
    const lplaats = str(r[idx.laadlosplaats]);

    // Bij laden = klant levert via terminal → klant
    //   laad_naam = opzetterminal, los_naam = laadlosbedrijf
    // Bij lossen = klant ontvangt → ander
    //   laad_naam = laadlosbedrijf, los_naam = afzetterminal
    let laad_naam, laad_plaats, los_naam, los_plaats;
    if (isLaden) {
      laad_naam = opzet; laad_plaats = null;
      los_naam = lbedrijf; los_plaats = lplaats;
    } else {
      laad_naam = lbedrijf; laad_plaats = lplaats;
      los_naam = afzet; los_plaats = null;
    }

    const rij = {
      ritnummer: str(r[idx.refKlant]) || (idx.id >= 0 ? str(r[idx.id]) : null),
      datum,
      laad_naam, laad_plaats, laad_postcode: null, laad_land: null,
      los_naam, los_plaats, los_postcode: null, los_land: null,
      containertype: str(r[idx.containertype]),
      containernummer: str(r[idx.container]),
      gewicht_kg: num(r[idx.brutogewicht]),
      is_adr: bool(r[idx.adr]),
      basis_tarief: null,    // niet gesplitst in oudedata
      adr_toeslag: null,
      diesel_toeslag: null,
      wachtuur_aantal: null,
      wachtuur_tarief: null,
      overige_toeslagen: {},
      totaal_bedrag: omzet,
      kilometers: null,
      chauffeur: null,
      voertuig: null,
      raw: {
        is_charter: bool(r[idx.charter]),
        uitgevoerd_door: str(r[idx.uitgevoerdDoor]),
        rederij: str(r[idx.rederij]),
        bootnaam: str(r[idx.bootnaam]),
        opzetterminal: opzet,
        afzetterminal: afzet,
        lading: str(r[idx.lading]),
        inkoop, btw_charter: num(r[idx.btwCharter]),
        derden: num(r[idx.derden]),
        resultaat: num(r[idx.resultaat]),
        laad_of_lossen: str(r[idx.laadOfLossen]),
        ref_klant: str(r[idx.refKlant]),
      },
      _klant: klant,
    };
    rijen.push(rij);

    if (!klantStats.has(klant)) klantStats.set(klant, { count: 0, omzet: 0, inkoop: 0 });
    const s = klantStats.get(klant);
    s.count++;
    if (omzet) s.omzet += omzet;
    if (inkoop) s.inkoop += inkoop;
  }

  return {
    totaalRijen: rijen.length,
    aantalKlanten: klantStats.size,
    klantStats: [...klantStats.entries()]
      .map(([k, v]) => ({ klant: k, count: v.count, omzet: v.omzet, inkoop: v.inkoop }))
      .sort((a, b) => b.count - a.count),
    rijen,
  };
}
