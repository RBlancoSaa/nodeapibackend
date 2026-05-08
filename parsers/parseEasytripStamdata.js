// parsers/parseEasytripStamdata.js
//
// Parser voor het Easy_trip_info.xlsx bestand met meerdere sheets:
//   - Bestemmingen en stops
//   - charters
//   - Chauffeurs
//   - Containers
//   - Klanten
//   - Op- & Afzetten
//   - Rederijen
//   - Type stops
//   - Terminal regio's
//
// Levert een gestructureerd object op dat als referentielijst kan dienen
// (op te slaan in Supabase Storage referentielijsten bucket of in eigen tabellen).

import XLSX from 'xlsx';

function rowsFromSheet(wb, sheetName) {
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

function findSheet(sheetNames, ...keywords) {
  return sheetNames.find(n => {
    const ln = n.toLowerCase();
    return keywords.some(k => ln.includes(k.toLowerCase()));
  });
}

export function parseEasytripStamdata(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetNames = wb.SheetNames;

  const result = {
    sheetNames,
    bestemmingen: [],
    charters: [],
    chauffeurs: [],
    containers: [],
    klanten: [],
    opAfzetten: [],
    rederijen: [],
    typeStops: [],
    terminalRegios: [],
    documenttypen: [],
  };

  const map = {
    bestemmingen:    findSheet(sheetNames, 'bestemmingen'),
    charters:        findSheet(sheetNames, 'charter'),
    chauffeurs:      findSheet(sheetNames, 'chauffeur'),
    containers:      findSheet(sheetNames, 'container'),
    klanten:         findSheet(sheetNames, 'klant'),
    opAfzetten:      findSheet(sheetNames, 'op- & afzet', 'op-/afzet', 'op afzet'),
    rederijen:       findSheet(sheetNames, 'rederij'),
    typeStops:       findSheet(sheetNames, 'type stop'),
    terminalRegios:  findSheet(sheetNames, 'terminal regio'),
    documenttypen:   findSheet(sheetNames, 'documenttype'),
  };

  for (const [key, sheet] of Object.entries(map)) {
    if (sheet) result[key] = rowsFromSheet(wb, sheet).filter(r => Object.values(r).some(v => v !== null && v !== ''));
  }

  return {
    sheetNames,
    counts: {
      bestemmingen:   result.bestemmingen.length,
      charters:       result.charters.length,
      chauffeurs:     result.chauffeurs.length,
      containers:     result.containers.length,
      klanten:        result.klanten.length,
      opAfzetten:     result.opAfzetten.length,
      rederijen:      result.rederijen.length,
      typeStops:      result.typeStops.length,
      terminalRegios: result.terminalRegios.length,
      documenttypen:  result.documenttypen.length,
    },
    data: result,
  };
}
