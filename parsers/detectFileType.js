// parsers/detectFileType.js
//
// Auto-detect logica voor uploads.
//
// Mogelijke types:
//   - 'rpt_facturen_xps'    → XPS-factuurarchief (rptFacturen.xps)
//   - 'tiaro_rittenarchief' → Excel met de hele rittenhistorie van Tiaro
//                             (oudedata.xlsx — kolommen Omzet, Inkoop, Charter, ...)
//   - 'easytrip_stamdata'   → Excel met meerdere sheets met referentiedata
//                             (Bestemmingen, Klanten, Containers, Rederijen, ...)
//   - 'adresboek'           → Excel met één sheet (Naam, Adres, Postcode, Plaats, Type)
//   - 'losse_factuur_pdf'   → PDF met één factuur (toekomstig)
//   - 'onbekend'

import XLSX from 'xlsx';

const STAMDATA_SHEETS = ['bestemmingen en stops', 'klanten', 'containers', 'rederijen', 'charters', 'chauffeurs'];
const RITTEN_SIGNALS  = ['omzet', 'inkoop', 'charter', 'uitgevoerd door', 'opzetterminal', 'afzetterminal'];
const ADRESBOEK_SIGNALS = ['naam', 'adres', 'postcode', 'plaats', 'type'];

function normaliseer(s) {
  return String(s || '').toLowerCase().trim();
}

/**
 * Detecteer het type bestand op basis van extensie + inhoud.
 * @param {Buffer} buffer
 * @param {string} bestandsnaam
 * @returns {object} { type, vertrouwen, details }
 */
export function detectFileType(buffer, bestandsnaam = '') {
  const naam = (bestandsnaam || '').toLowerCase();

  // 1. Snelle extensie-check
  if (naam.endsWith('.xps')) {
    // Verifieer: ZIP-magic + Documents/1/Pages
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B) {
      return { type: 'rpt_facturen_xps', vertrouwen: 'hoog', details: { extensie: 'xps' } };
    }
    return { type: 'onbekend', vertrouwen: 'laag', details: { reden: '.xps bestand maar geen ZIP-magic' } };
  }

  if (naam.endsWith('.pdf')) {
    return { type: 'losse_factuur_pdf', vertrouwen: 'middel', details: { extensie: 'pdf' } };
  }

  if (naam.endsWith('.xlsx') || naam.endsWith('.xls')) {
    let wb;
    try {
      wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    } catch (e) {
      return { type: 'onbekend', vertrouwen: 'laag', details: { reden: 'Kan Excel niet lezen: ' + e.message } };
    }
    const sheetNames = wb.SheetNames.map(s => normaliseer(s));

    // Multi-sheet stamdata?
    const stamdataMatches = sheetNames.filter(n => STAMDATA_SHEETS.some(sd => n.includes(sd))).length;
    if (sheetNames.length >= 4 && stamdataMatches >= 3) {
      return {
        type: 'easytrip_stamdata',
        vertrouwen: 'hoog',
        details: { sheetCount: sheetNames.length, herkendeSheets: stamdataMatches, sheetNames: wb.SheetNames },
      };
    }

    // Eén-sheet bestand: kijk naar headers
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
    if (!rows.length) {
      return { type: 'onbekend', vertrouwen: 'laag', details: { reden: 'Lege sheet' } };
    }
    const headers = rows[0].map(h => normaliseer(h));

    // Tiaro rittenarchief? (heeft Omzet + Inkoop + Charter samen)
    const rittenScore = RITTEN_SIGNALS.filter(sig => headers.some(h => h.includes(sig))).length;
    if (rittenScore >= 4) {
      return {
        type: 'tiaro_rittenarchief',
        vertrouwen: 'hoog',
        details: { kolommen: headers.length, herkendeSignalen: rittenScore, sheetName: wb.SheetNames[0] },
      };
    }

    // Adresboek?
    const adresboekScore = ADRESBOEK_SIGNALS.filter(sig => headers.some(h => h === sig || h.includes(sig))).length;
    if (adresboekScore >= 4) {
      return {
        type: 'adresboek',
        vertrouwen: 'hoog',
        details: { kolommen: headers.length, herkendeSignalen: adresboekScore, sheetName: wb.SheetNames[0] },
      };
    }

    // Klantenlijst (bv klanten__tiaro.xlsx)?
    if (headers.includes('naam') && headers.includes('adres') && headers.includes('type')) {
      return {
        type: 'adresboek',
        vertrouwen: 'middel',
        details: { sheetName: wb.SheetNames[0] },
      };
    }

    // Easytrip Excel-export (single sheet) — heeft typische kolommen
    if (headers.some(h => h.includes('rit')) && headers.some(h => h.includes('tarief') || h.includes('basis'))) {
      return {
        type: 'easytrip_export',
        vertrouwen: 'middel',
        details: { kolommen: headers.length, sheetName: wb.SheetNames[0] },
      };
    }

    return {
      type: 'onbekend',
      vertrouwen: 'laag',
      details: { reden: 'Excel met onbekende kolomstructuur', headers },
    };
  }

  return { type: 'onbekend', vertrouwen: 'laag', details: { reden: 'Onbekende bestandsextensie' } };
}
