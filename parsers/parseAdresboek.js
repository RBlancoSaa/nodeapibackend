// parsers/parseAdresboek.js
//
// Parser voor adresboek/klantenlijst Excel (1 sheet, kolommen Naam/Adres/...).
// Gebruikt voor klanten__tiaro.xlsx en Adresboek.xlsx.

import XLSX from 'xlsx';

function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === '0' || s === '.' ? null : s;
}

export function parseAdresboek(buffer, opts = {}) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = opts.sheetName || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  if (!rows.length) return { error: 'Lege sheet', entries: [] };

  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
  const idxNaam      = headers.findIndex(h => h === 'naam' || h === 'bedrijfsnaam');
  const idxAdres     = headers.findIndex(h => h === 'adres');
  const idxPostcode  = headers.findIndex(h => h === 'postcode');
  const idxPlaats    = headers.findIndex(h => h === 'plaats');
  const idxTelefoon  = headers.findIndex(h => h === 'telefoon');
  const idxMobiel    = headers.findIndex(h => h === 'mobiel');
  const idxEmail     = headers.findIndex(h => h === 'email' || h === 'e-mail');
  const idxType      = headers.findIndex(h => h === 'type');
  const idxLand      = headers.findIndex(h => h === 'land');

  if (idxNaam < 0) return { error: 'Geen "Naam" kolom gevonden', entries: [] };

  const entries = [];
  const typeStats = new Map();
  for (const r of rows.slice(1)) {
    const naam = str(r[idxNaam]);
    if (!naam) continue;
    const t = str(r[idxType]) || 'overige';
    const e = {
      naam,
      adres: idxAdres >= 0 ? str(r[idxAdres]) : null,
      postcode: idxPostcode >= 0 ? str(r[idxPostcode]) : null,
      plaats: idxPlaats >= 0 ? str(r[idxPlaats]) : null,
      land: idxLand >= 0 ? str(r[idxLand]) : null,
      telefoon: idxTelefoon >= 0 ? str(r[idxTelefoon]) : null,
      mobiel: idxMobiel >= 0 ? str(r[idxMobiel]) : null,
      email: idxEmail >= 0 ? str(r[idxEmail]) : null,
      type: t,
    };
    entries.push(e);
    typeStats.set(t, (typeStats.get(t) || 0) + 1);
  }

  return {
    totaalEntries: entries.length,
    sheetName,
    typeStats: [...typeStats.entries()].map(([type, count]) => ({ type, count })),
    entries,
  };
}
