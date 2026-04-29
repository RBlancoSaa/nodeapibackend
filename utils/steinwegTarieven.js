/**
 * utils/steinwegTarieven.js
 *
 * Tarief-berekening voor Steinweg Route 1 (vol) en Route 2 (leeg).
 * Bevat alle tariefmatrices en hulpfuncties.
 */

// ─── Terminal-normalisatie ────────────────────────────────────────────────────

/**
 * Normaliseert terminalnaam naar een interne sleutel voor toeslag-logica.
 * APM 2 en RWG worden APART gehouden (verschillende toeslagen).
 */
export function normTerminalKey(naam) {
  const s = (naam || '').toLowerCase().replace(/[\s\-_\/]+/g, ' ').trim();
  if (/ect delta|delta ii|hpd 2|hpd2/.test(s)) return 'ect_delta';
  if (/euromax|emx/.test(s))                    return 'emx';
  if (/\brwg\b/.test(s))                        return 'rwg';
  if (/apm 2|apm2|apm.*ii|apmii/.test(s))       return 'apm2';
  if (/\bwbt\b/.test(s))                        return 'wbt';
  if (/\brst\b/.test(s))                        return 'rst';
  return null;
}

/**
 * Normaliseert terminalnaam naar tariefsleutel voor de vol-tabel.
 * APM 2 en RWG gebruiken dezelfde tarieven → 'apm2_rwg'.
 */
function normTerminalKeyVol(naam) {
  const key = normTerminalKey(naam);
  if (key === 'rwg' || key === 'apm2') return 'apm2_rwg';
  return key; // 'ect_delta' | 'emx' | 'wbt' | 'rst' | null
}

// ─── Depot-normalisatie ───────────────────────────────────────────────────────

/**
 * Normaliseert depotnaam naar tariefsleutel voor de leeg-tabel.
 * APM 2 en RWG: zelfde leeg-tarief → 'apm2_rwg'.
 */
function normDepotKey(naam) {
  const s = (naam || '').toLowerCase().replace(/[\s\-_\/]+/g, ' ').trim();
  if (/ect delta|delta ii/.test(s))         return 'ect_delta';
  if (/apm 2|apm2|\brwg\b/.test(s))        return 'apm2_rwg';
  if (/euromax|emx/.test(s))               return 'emx';
  if (/\bwbt\b/.test(s))                   return 'wbt';
  if (/\brst\b/.test(s))                   return 'rst';
  if (/uwt.*7|uwt7/.test(s))              return 'uwt_7';
  if (/uwt.*2|uwt2/.test(s))              return 'uwt_2';
  if (/uwt|uct/.test(s))                  return 'uwt_waalhaven';
  if (/medrep|medrepair/.test(s))         return 'medrep';
  if (/cetem/.test(s))                    return 'cetem';
  if (/van\s*doorn/.test(s))              return 'van_doorn';
  if (/kramer/.test(s))                   return 'kramer';
  if (/moerdijk/.test(s))                 return 'moerdijk';
  return null;
}

// ─── Zone-detectie ────────────────────────────────────────────────────────────

/**
 * Detecteert tariefzone op basis van locatienaam/adres.
 * Zones: 'benelux' | 'waalhaven' | 'botlek' | 'seine'
 * Geeft null terug als niet herkend (caller kan dan default kiezen).
 */
export function detectZone(locatie) {
  const s = (locatie || '').toLowerCase();
  if (/benelux/.test(s))                                                     return 'benelux';
  if (/parmentier|pier\s*[1-9]|beatrix|sluisjesdijk|spakenburg|heijplaat/.test(s)) return 'waalhaven';
  if (/waalhaven/.test(s))                                                   return 'waalhaven';
  if (/botlek|theemsweg|theemswerg|vondelingenplaat/.test(s))                return 'botlek';
  if (/seine/.test(s))                                                       return 'seine';
  return null;
}

// ─── Terminals met congestie-toeslag ─────────────────────────────────────────

function isCongestieTerminal(key) {
  return key === 'ect_delta' || key === 'emx' || key === 'rwg' || key === 'apm2';
}

// ─── Vol uithalen tarieven ────────────────────────────────────────────────────
// VOL[terminalKey][zone] = { ft20, ft40 }

const VOL = {
  ect_delta: {
    benelux:   { ft20: 100, ft40: 100 },
    waalhaven: { ft20: 140, ft40: 140 },
    botlek:    { ft20: 120, ft40: 120 },
    seine:     { ft20: 120, ft40: 120 },
  },
  apm2_rwg: {
    benelux:   { ft20: 100, ft40: 100 },
    waalhaven: { ft20: 140, ft40: 140 },
    botlek:    { ft20: 120, ft40: 120 },
    seine:     { ft20: 120, ft40: 120 },
  },
  emx: {
    benelux:   { ft20: 110, ft40: 100 },
    waalhaven: { ft20: 150, ft40: 150 },
    botlek:    { ft20: 130, ft40: 130 },
    seine:     { ft20: 130, ft40: 130 },
  },
  wbt: {
    benelux:   { ft20: 120, ft40: 120 },
    waalhaven: { ft20: 120, ft40: 100 },
    botlek:    { ft20: 100, ft40: 100 },
    seine:     { ft20: 100, ft40: 100 },
  },
  rst: {
    benelux:   { ft20: 130, ft40: 130 },
    waalhaven: { ft20: 95,  ft40: 95  },
    botlek:    { ft20: 120, ft40: 120 },
    seine:     { ft20: 120, ft40: 120 },
  },
};

// ─── Leeg retour tarieven ─────────────────────────────────────────────────────
// LEEG[depotKey][zone] = { ft20, ft40 }
// zone = zone van de Steinweg opzetlocatie (niet van het depot)

const LEEG = {
  ect_delta: {
    benelux:   { ft20: 60,   ft40: 120 },
    waalhaven: { ft20: 80,   ft40: 160 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  apm2_rwg: {
    benelux:   { ft20: 60,   ft40: 120 },
    waalhaven: { ft20: 80,   ft40: 160 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  emx: {
    benelux:   { ft20: 65,   ft40: 130 },
    waalhaven: { ft20: 85,   ft40: 170 },
    botlek:    { ft20: 75,   ft40: 150 },
    seine:     { ft20: 75,   ft40: 150 },
  },
  wbt: {
    benelux:   { ft20: 70,   ft40: 140 },
    waalhaven: { ft20: 70,   ft40: 140 },
    botlek:    { ft20: 57.5, ft40: 115 },
    seine:     { ft20: 57.5, ft40: 115 },
  },
  rst: {
    benelux:   { ft20: 75,   ft40: 150 },
    waalhaven: { ft20: 57.5, ft40: 115 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  uwt_waalhaven: {
    benelux:   { ft20: 75,   ft40: 150 },
    waalhaven: { ft20: 57.5, ft40: 115 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  uwt_2: {
    benelux:   { ft20: 75,   ft40: 150 },
    waalhaven: { ft20: 57.5, ft40: 115 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  uwt_7: {
    benelux:   { ft20: 75,   ft40: 150 },
    waalhaven: { ft20: 57.5, ft40: 115 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  medrep: {
    benelux:   { ft20: 70,   ft40: 140 },
    waalhaven: { ft20: 57.5, ft40: 115 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  cetem: {
    benelux:   { ft20: 70,   ft40: 140 },
    waalhaven: { ft20: 70,   ft40: 140 },
    botlek:    { ft20: 57.5, ft40: 115 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  van_doorn: {
    benelux:   { ft20: 75,   ft40: 150 },
    waalhaven: { ft20: 57.5, ft40: 115 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  kramer: {
    benelux:   { ft20: 60,   ft40: 120 },
    waalhaven: { ft20: 80,   ft40: 160 },
    botlek:    { ft20: 70,   ft40: 140 },
    seine:     { ft20: 70,   ft40: 140 },
  },
  moerdijk: {
    benelux:   { ft20: 120,  ft40: 240 },
    waalhaven: { ft20: 95,   ft40: 190 },
    botlek:    { ft20: 90,   ft40: 180 },
    seine:     { ft20: 90,   ft40: 180 },
  },
};

// ─── Hoofd-berekening ─────────────────────────────────────────────────────────

/**
 * Berekent financiële velden voor Route 1 (volle container).
 *
 * @param {string} terminalNaam  - r1.from (opzetten terminal)
 * @param {string} bestemmingNaam - r1.to (afleverlocatie = Steinweg-adres)
 * @param {string} sizeStr       - '20ft' | '40ft' | '45ft HC' etc.
 * @returns {object} financieel-object voor enrichOrder/generateXml
 */
export function berekenVolTarief(terminalNaam, bestemmingNaam, sizeStr) {
  const terminalKeyVol = normTerminalKeyVol(terminalNaam);
  const terminalKey    = normTerminalKey(terminalNaam);
  const zone           = detectZone(bestemmingNaam) || 'waalhaven'; // default Waalhaven
  const ft             = sizeStr.startsWith('20') ? 'ft20' : 'ft40';

  let tarief = 0;
  if (terminalKeyVol && VOL[terminalKeyVol]?.[zone]) {
    tarief = VOL[terminalKeyVol][zone][ft] ?? 0;
  }
  console.log(`💰 Vol tarief: "${terminalNaam}" (${terminalKeyVol}) → zone="${zone}" ${ft} → €${tarief}`);

  // Congestie: €20 per container (nooit gehalveerd voor volle containers)
  const blanco1Chart = isCongestieTerminal(terminalKey) ? 20 : 0;

  // Terminal-specifieke toeslag
  let deltaChart   = 0;
  let euromaxChart = 0;
  let blanco2Chart = 0;
  let blanco2Text  = '';

  if (terminalKey === 'ect_delta') {
    deltaChart = 28.50;
  } else if (terminalKey === 'emx') {
    euromaxChart = 28.50;
  } else if (terminalKey === 'rwg') {
    blanco2Chart = 30;
    blanco2Text  = 'RWG toeslag';
  }

  return {
    tarief,
    dieselToeslagChart: 9,
    deltaChart,
    euromaxChart,
    blanco1Chart,
    blanco1Text: blanco1Chart > 0 ? 'congestie toeslag' : '',
    blanco2Chart,
    blanco2Text,
  };
}

/**
 * Berekent financiële velden voor Route 2 (lege container).
 *
 * @param {string} depotNaam  - c2.returnDepot (afzetdepot)
 * @param {string} opzetNaam  - r2.from (Steinweg opzetlocatie)
 * @param {string} sizeStr    - '20ft' | '40ft'
 * @param {boolean} isPaired  - true als container in een setje van 2 rijdt
 * @returns {object} financieel-object voor enrichOrder/generateXml
 */
export function berekenLeegTarief(depotNaam, opzetNaam, sizeStr, isPaired) {
  const depotKey = normDepotKey(depotNaam);
  const zone     = detectZone(opzetNaam) || 'waalhaven'; // default Waalhaven
  const ft       = sizeStr.startsWith('20') ? 'ft20' : 'ft40';

  let tarief = 0;
  if (depotKey && LEEG[depotKey]?.[zone]) {
    const basis = LEEG[depotKey][zone][ft] ?? 0;
    tarief = isPaired ? basis / 2 : basis;
  }
  console.log(`💰 Leeg tarief: depot="${depotNaam}" (${depotKey}) zone="${zone}" ${ft} pair=${isPaired} → €${tarief}`);

  // Congestie bij inlevering op zee-terminal als depot
  const depotTerminalKey = normTerminalKey(depotNaam);
  const congestieBasis   = isCongestieTerminal(depotTerminalKey) ? 20 : 0;
  const blanco1Chart     = isPaired ? congestieBasis / 2 : congestieBasis;

  // Terminal-specifieke toeslag bij afzetdepot (gehalveerd bij setje)
  let deltaChart   = 0;
  let euromaxChart = 0;
  let blanco2Chart = 0;
  let blanco2Text  = '';

  if (depotTerminalKey === 'ect_delta') {
    deltaChart = isPaired ? 28.50 / 2 : 28.50;
  } else if (depotTerminalKey === 'emx') {
    euromaxChart = isPaired ? 28.50 / 2 : 28.50;
  } else if (depotTerminalKey === 'rwg') {
    blanco2Chart = isPaired ? 30 / 2 : 30;
    blanco2Text  = 'RWG toeslag';
  }

  return {
    tarief,
    dieselToeslagChart: 9,
    deltaChart,
    euromaxChart,
    blanco1Chart,
    blanco1Text: blanco1Chart > 0 ? 'congestie toeslag' : '',
    blanco2Chart,
    blanco2Text,
  };
}

/**
 * Berekent voor een lijst Route-2 containers welke in een setje (pair) rijden.
 * Groepeer 20ft containers per returnDepot; paren van 2 = gehalveerd tarief.
 * 40ft-containers rijden altijd alleen (nooit gepaard).
 *
 * @param {Array} containers  - r2.containers array
 * @param {Function} sizeOf   - fn(container) → '20ft' | '40ft' | ...
 * @returns {Set<string>} Set van containernummers die in een setje rijden
 */
export function berekenPairs(containers, sizeOf) {
  // Groepeer 20ft containers per depot
  const depotGroups = {};
  for (const c of containers) {
    if (sizeOf(c) !== '20ft') continue;
    const key = (c.returnDepot || '').toLowerCase().trim();
    if (!depotGroups[key]) depotGroups[key] = [];
    depotGroups[key].push(c);
  }

  // Markeer containers die gepaard rijden (altijd een even aantal per depot)
  const paired = new Set();
  for (const group of Object.values(depotGroups)) {
    const pairCount = Math.floor(group.length / 2) * 2;
    for (let i = 0; i < pairCount; i++) {
      paired.add(group[i].containernummer);
    }
  }
  return paired;
}
