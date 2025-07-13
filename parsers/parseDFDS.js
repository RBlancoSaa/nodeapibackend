// parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

// --- HELPERS MET DEBUG-LOGS ---
// Veilige match + trim, met logs
function safeMatch(pattern, text, group = 1, label = '') {
  if (typeof text !== 'string') {
    console.warn(`⚠️ safeMatch ${label}: tekst is geen string:`, text);
    return '';
  }
  const match = text.match(pattern);
  if (!match) {
    console.log(`🔍 safeMatch ${label}: geen match voor ${pattern} in ‘${text}’`);
    return '';
  }
  if (typeof match[group] !== 'string') {
    console.warn(`⚠️ safeMatch ${label}: groep ${group} niet-string:`, match[group]);
    return '';
  }
  const res = match[group].trim();
  console.log(`✅ safeMatch ${label}: ‘${text}’ → ‘${res}’`);
  return res;
}

// Zoek de eerste match in een array regels, met logs
function findFirst(pattern, lines, label = '') {
  for (const line of lines) {
    const m = line.match(pattern);
    if (m && typeof m[1] === 'string') {
      console.log(`✅ findFirst ${label}: regex ${pattern} in ‘${line}’ → ‘${m[1].trim()}’`);
      return m[1].trim();
    }
  }
  console.log(`🔍 findFirst ${label}: geen match voor ${pattern}`);
  return '';
}

export default async function parseDFDS(pdfBuffer, klantAlias = 'dfds') {
  // --- BASIC VALIDATION ---
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('❌ Ongeldige of ontbrekende PDF buffer');
    return {};
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }

  // --- PDF PARSEN & LINES ---
  const parsed = await pdfParse(pdfBuffer);
  const rawLines = parsed.text.split('\n');
  const text = parsed.text;
  const regels = rawLines
  .map(l =>
    l
      // m3Pickup → m3 Pickup
      .replace(/m3Pickup/i, 'm3 Pickup ')
      // 7PORT → 7 PORT
      .replace(/([0-9])([A-Z])/g, '$1 $2')
      .trim()
  )
  .filter(Boolean);

  console.log(`ℹ️ In totaal ${regels.length} opgeschoonde regels gevonden`);
  console.log(`ℹ️ In totaal ${regels.length} niet-lege regels gevonden`);

  
  // --- SECTIONS BEPALEN ---
  const idxTransportInfo = regels.findIndex(r => /^Transport informatie/i.test(r));
  const idxGoederenInfo = regels.findIndex(r => /^Goederen informatie/i.test(r));
  console.log(`ℹ️ Transport-info begint op regel ${idxTransportInfo}, goederen-info op ${idxGoederenInfo}`);

const splitLines = tekst
  .split('\n')
  .map(l =>
    l
      .replace(/m3Pickup/i, 'm3 Pickup ')
      .replace(/([0-9])([A-Z])/g, '$1 $2')  // '7PORT' → '7 PORT'
      .trim()
  )
  .filter(Boolean);

  // --- TRANSPORT INFORMATIE: CONTAINER / REF / DATUM / TIJD ---
  const transportLines = idxTransportInfo >= 0 && idxGoederenInfo > idxTransportInfo
    ? regels.slice(idxTransportInfo + 1, idxGoederenInfo)
    : [];

  // Container nr
  const containernummer = findFirst(/([A-Z]{4}\d{7})/, transportLines, 'containernummer');

  // Containertype (origineel)
let containertypeRaw = findFirst(
  new RegExp(`${containernummer}\\s*([0-9]{2,3}(?:ft)?\\s?[A-Za-z]{2,3})`, 'i'),
  transportLines,
  'containertype-via-contnr'
);

if (!containertypeRaw) {
  // fallback: match eender waar “40ft HC”, “20GP” etc.
  containertypeRaw = findFirst(
    /([0-9]{2,3}ft\s?[A-Za-z]{2,3}|20GP|40GP|40HC|45HC|45R1|20DC|40DC|20RF|40RF|45RF|20OT|40OT|20FR|40FR)/i,
    transportLines,
    'containertype-standaard'
  );
}

console.log(`🔍 containertypeRaw: '${containertypeRaw}'`);

  const normalizedContainertype = containertypeRaw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  console.log(`🔍 normalizedContainertype: ‘${normalizedContainertype}’`);

  // Volume: grootste m3
  let volume = '';
  for (const l of transportLines) {
    const m = l.match(/([\d.,]+)\s*m3/i);
    if (m && m[1]) {
      const v = m[1].replace(',', '.');
      if (!volume || parseFloat(v) > parseFloat(volume)) {
        volume = v;
      }
    }
  }
  console.log(`🔍 volume: ‘${volume}’`);

  // Referenties: pickup & lossen
    const pickupReferentie = findFirst(
    /Pickup[:\s]*([A-Za-z0-9]+)/i,
    transportLines,
    'pickup-ref'
    );
    const lossenReferentie = findFirst(
      /Lossen[:\s]*([A-Za-z0-9]+)/i,
      transportLines,
      'lossen-ref'
    );
    console.log(`🔍 pickupReferentie: '${pickupReferentie}', lossenReferentie: '${lossenReferentie}'`);
      
// Datum & Tijd (Lossen)
  let datum = '';
  let tijd = '';
  const anyDateLine = transportLines.find(l => /\d{2}-\d{2}-\d{4}/.test(l));
  if (anyDateLine) {
    datum = safeMatch(/(\d{2}-\d{2}-\d{4})/, anyDateLine, 1, 'datum');
    // tijd kan ook in dezelfde lijn staan: “07:30-15:30” of “07:30 - 15:30”
    tijd = safeMatch(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/, anyDateLine, 0, 'tijd');
    // normaliseren naar “hhmm-hhmm”
    if (tijd) {
      tijd = tijd.replace(/:/g, '').replace(/\s*-\s*/, '-');
    }
  }
  console.log(`🔍 datum: '${datum}', tijd: '${tijd}'`);

  // --- TERMINALS: NAAM + ADRES uit blok vóór Goederen informatie ---
  let pickupTerminal = '', pickupAdres = '';
  let klantNaam = '', klantAdres = '', klantPostcode = '', klantPlaats = '';
  let dropoffTerminal = '', dropoffAdres = '';

  // Vind het eerste pickup/ lossen/ dropoff in transportLines of in de daarop volgende regels tot Goederen-info
  const terminalSection = regels.slice(
    idxTransportInfo + 1,
    idxGoederenInfo > 0 ? idxGoederenInfo : regels.length
  );
  // Indices
  const iPU = terminalSection.findIndex(r => /^Pickup\b/i.test(r));
  const iLO = terminalSection.findIndex(r => /^Lossen\b/i.test(r));
  const iDO = terminalSection.findIndex(r => /^Dropoff\b/i.test(r));

  if (iPU !== -1) {
    pickupTerminal = terminalSection[iPU].replace(/^Pickup\s*/i, '').trim();
    pickupAdres = (terminalSection[iPU + 1] || '').trim();
    console.log(`🔍 pickupTerminal: ‘${pickupTerminal}’, pickupAdres: ‘${pickupAdres}’`);
  }
  if (iLO !== -1) {
    klantNaam = terminalSection[iLO].replace(/^Lossen\s*/i, '').trim();
    klantAdres = (terminalSection[iLO + 1] || '').trim();
    console.log(`🔍 klantNaam (Lossen): ‘${klantNaam}’, klantAdres: ‘${klantAdres}’`);
    // postcode + plaats uit adreslijn
    const pcMatch = klantAdres.match(/(\d{4}\s?[A-Z]{2})\s*([A-Za-z\- ]+)/);
    if (pcMatch) {
      klantPostcode = pcMatch[1].trim();
      klantPlaats = pcMatch[2].trim();
    }
  }
  if (iDO !== -1) {
    dropoffTerminal = terminalSection[iDO].replace(/^Dropoff\s*/i, '').trim();
    dropoffAdres = (terminalSection[iDO + 1] || '').trim();
    console.log(`🔍 dropoffTerminal: ‘${dropoffTerminal}’, dropoffAdres: ‘${dropoffAdres}’`);
  }

  // --- GOEDEREN INFORMATIE: colli, lading, gewicht (grootste kg) ---
  const goederenLines = idxGoederenInfo >= 0
    ? regels.slice(idxGoederenInfo + 1)
    : [];
  let colli = findFirst(/(\d+)\s*(?:carton|colli|pcs)/i, goederenLines, 'colli');
  let lading = findFirst(/(?:\d+\s+(?:carton|colli|pcs)\s+)([A-Za-z0-9\-\s]+)/i, goederenLines, 'lading');
  let gewicht = '';
  for (const l of goederenLines) {
    const m = l.match(/([\d.,]+)\s*kg/i);
    if (m && m[1]) {
      const w = m[1].replace(',', '.');
      if (!gewicht || parseFloat(w) > parseFloat(gewicht)) {
        gewicht = w;
      }
    }
  }
  console.log(`🔍 colli: ‘${colli}’, lading: ‘${lading}’, gewicht: ‘${gewicht}’`);

  // --- CONTAINERTYPE CODE OPVRAGEN ---
  let containertypeCode = '0';
  if (normalizedContainertype) {
    try {
      containertypeCode = await getContainerTypeCode(normalizedContainertype);
      console.log(`📦 containertypeCode: ‘${containertypeCode}’`);
    } catch (e) {
      console.warn('⚠️ Fout bij ophalen containertypeCode:', e);
    }
  }

  // --- OPBOUW DATA OBJECT ---
  const data = {
    container_nr: containernummer,
    containertype: containertypeRaw,
    containertype_code: containertypeCode,
    volume: volume,
    pickup_referentie: pickupReferentie,
    lossen_referentie: lossenReferentie,
    datum: datum,
    tijd: tijd,
    pickup_terminal: pickupTerminal,
    pickup_adres: pickupAdres,
    klant_naam: klantNaam,
    klant_adres: klantAdres,
    klant_postcode: klantPostcode,
    klant_plaats: klantPlaats,
    dropoff_terminal: dropoffTerminal,
    dropoff_adres: dropoffAdres,
    colli: colli,
    lading: lading,
    gewicht: gewicht
  };

  console.log('✅ Eindresultaat data object:', JSON.stringify(data, null, 2));
  return data;
}