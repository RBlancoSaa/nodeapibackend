// parsers/parseDFDS.js

import '../utils/fsPatch.js';
import { Buffer } from 'buffer';
import PDFParser from 'pdf2json';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

// ─── extractLines via pdf2json ──────────────────────────────────────────────
function extractLines(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();

    pdfParser.on('pdfParser_dataError', err => {
      console.error('❌ pdf2json error:', err.parserError);
      reject(err.parserError);
    });

    pdfParser.on('pdfParser_dataReady', pdf => {
      const linesMap = new Map();
      for (const page of pdf.Pages) {
        for (const item of page.Texts) {
          const text = decodeURIComponent(item.R[0].T);
          const yKey = item.y.toFixed(2);
          if (!linesMap.has(yKey)) linesMap.set(yKey, []);
          linesMap.get(yKey).push({ x: item.x, text });
        }
      }
      const ys = Array.from(linesMap.keys())
        .map(k => parseFloat(k))
        .sort((a, b) => b - a);
      const allLines = ys.map(y => {
        const key = y.toFixed(2);
        return linesMap.get(key)
          .sort((a, b) => a.x - b.x)
          .map(run => run.text)
          .join(' ')
          .trim();
      });
      resolve(allLines);
    });

    pdfParser.parseBuffer(buffer);
  });
}

// ─── HELPERS MET DEBUG-LOGS ──────────────────────────────────────────────────
function safeMatch(pattern, text, group = 1) {
  if (typeof text !== 'string') return '';
  const m = text.match(pattern);
  return m && m[group] ? m[group].trim() : '';
}

function findFirst(pattern, lines) {
  for (const l of lines) {
    const m = l.match(pattern);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

// ─── MAIN PARSER ────────────────────────────────────────────────────────────
export default async function parseDFDS(pdfBuffer, klantAlias = 'dfds') {
  // 1) VALIDATIE
  if (!pdfBuffer || !(Buffer.isBuffer(pdfBuffer) || pdfBuffer instanceof Uint8Array)) {
    console.warn('❌ Ongeldige PDF buffer');
    return {};
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }

  // 2) PDF → splitLines
  let splitLines;
  try {
    splitLines = await extractLines(pdfBuffer);
  } catch (e) {
    console.error('❌ extractLines faalde:', e);
    return {};
  }
  if (!splitLines.length) {
    console.error('❌ Geen regels uit PDF gehaald');
    return {};
  }

  // 3) SECTIES BEPALEN
  const idxTransportInfo = splitLines.findIndex(r => /^Transport informatie/i.test(r));
  const idxGoederenInfo = splitLines.findIndex(r => /^Goederen informatie/i.test(r));

  // 4) TRANSPORT & GOEDEREN LINES
  const transportLines = (idxTransportInfo >= 0 && idxGoederenInfo > idxTransportInfo)
    ? splitLines.slice(idxTransportInfo + 1, idxGoederenInfo)
    : [];
  const goederenLines = (idxGoederenInfo >= 0)
    ? splitLines.slice(idxGoederenInfo + 1)
    : [];

  console.log('🛠 transportLines:', transportLines);

  // 5) CONTAINERNUMMER (3 letters + U + 7 cijfers)
  const containernummer = findFirst(/([A-Z]{3}U\d{7})/, transportLines);

  // 6) CONTAINERTYPE (RAW)
  let containertypeRaw = '';
  if (containernummer) {
    containertypeRaw = findFirst(
      new RegExp(`${containernummer}\\s*([0-9]{2,3}ft\\s?[A-Za-z]{2,3})`, 'i'),
      transportLines
    );
  }
  if (!containertypeRaw) {
    containertypeRaw = findFirst(/([0-9]{2,3}ft\s?[A-Za-z]{2,3}|20GP|40HC)/i, transportLines);
  }
  if (!containertypeRaw) {
    containertypeRaw = findFirst(/([0-9]{2,3}ft(?:HC|GP))/i, transportLines);
  }
  if (!containertypeRaw) {
    console.error('❌ Containertype ontbreekt');
    return {};
  }
  console.log(`🔍 containertypeRaw: '${containertypeRaw}'`);

  // 7) NORMALIZE & TYPECODE OPHALEN
  const normalizedContainertype = containertypeRaw
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  let containertypeCode = '0';
  try {
    containertypeCode = await getContainerTypeCode(normalizedContainertype);
  } catch (e) {
    console.warn('⚠️ Fout bij ophalen containertypeCode:', e);
  }
  console.log(`📦 containertypeCode: '${containertypeCode}'`);

  // 8) VOLUME (grootste m3)
  let volume = '';
  for (const l of transportLines) {
    const m = l.match(/([\d.,]+)\s*m3/i);
    if (m && m[1]) {
      const v = m[1].replace(',', '.');
      if (!volume || parseFloat(v) > parseFloat(volume)) volume = v;
    }
  }
  console.log(`🔍 volume: '${volume}'`);

  // 9) REFERENTIES
  const pickupReferentie = findFirst(/Pickup[:\s]*([A-Za-z0-9]+)/i, transportLines);
  const lossenReferentie = findFirst(/Lossen[:\s]*([A-Za-z0-9]+)/i, transportLines);
  console.log(`🔍 pickupReferentie: '${pickupReferentie}', lossenReferentie: '${lossenReferentie}'`);

  // 10) DATUM & TIJD
  let datum = '', tijd = '';
  const dateLine = transportLines.find(l => /\d{2}-\d{2}-\d{4}/.test(l));
  if (dateLine) {
    datum = safeMatch(/(\d{2}-\d{2}-\d{4})/, dateLine);
    tijd = safeMatch(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/, dateLine)
      .replace(/:/g, '').replace(/\s*-\s*/, '-');
  }
  console.log(`🔍 datum: '${datum}', tijd: '${tijd}'`);

  // 11) TERMINALS (pickup, lossen, dropoff)
  const terminalSection = splitLines.slice(
    idxTransportInfo + 1,
    idxGoederenInfo > 0 ? idxGoederenInfo : splitLines.length
  );
  const iPU = terminalSection.findIndex(r => /^Pickup\b/i.test(r));
  const iLO = terminalSection.findIndex(r => /^Lossen\b/i.test(r));
  const iDO = terminalSection.findIndex(r => /^Dropoff\b/i.test(r));

  let pickupTerminal = '', pickupAdres = '';
  let klantNaam = '', klantAdres = '', klantPostcode = '', klantPlaats = '';
  let dropoffTerminal = '', dropoffAdres = '';

  if (iPU !== -1) {
    pickupTerminal = terminalSection[iPU].replace(/^Pickup\s*/i, '').trim();
    pickupAdres = (terminalSection[iPU + 1] || '').trim();
  }
  if (iLO !== -1) {
    klantNaam = terminalSection[iLO].replace(/^Lossen\s*/i, '').trim();
    klantAdres = (terminalSection[iLO + 1] || '').trim();
    const pm = klantAdres.match(/(\d{4}\s?[A-Z]{2})\s*(.+)/);
    if (pm) {
      klantPostcode = pm[1].trim();
      klantPlaats = pm[2].trim();
    }
  }
  if (iDO !== -1) {
    dropoffTerminal = terminalSection[iDO].replace(/^Dropoff\s*/i, '').trim();
    dropoffAdres = (terminalSection[iDO + 1] || '').trim();
  }
  console.log('🔍 pickupTerminal:', pickupTerminal, pickupAdres);
  console.log('🔍 klant:', klantNaam, klantAdres);
  console.log('🔍 dropoff:', dropoffTerminal, dropoffAdres);

  // 12) GOEDEREN-INFORMATIE
  let colli = findFirst(/(\d+)\s*(?:carton|colli|pcs)/i, goederenLines);
  let lading = findFirst(/(?:\d+\s+(?:carton|colli|pcs)\s+)([A-Za-z0-9\-\s]+)/i, goederenLines);
  let gewicht = '', zegelnummer = '';
  for (const l of goederenLines) {
    const m = l.match(/([\d.,]+)\s*kg/i);
    if (m && m[1] && (!gewicht || parseFloat(m[1].replace(',', '.')) > parseFloat(gewicht))) {
      gewicht = m[1].replace(',', '.');
    }
    const z = l.match(/Zegel[:\s]*([A-Z0-9]+)/i);
    if (z && z[1]) zegelnummer = z[1].trim();
  }
  console.log(`🔍 colli: '${colli}', lading: '${lading}', gewicht: '${gewicht}', zegel: '${zegelnummer}'`);

  // 13) BUILD DATA OBJECT
  const data = {
    container_nr: containernummer,
    containertype: containertypeRaw,
    containertype_code: containertypeCode,
    volume,
    pickup_referentie: pickupReferentie,
    lossen_referentie: lossenReferentie,
    datum,
    tijd,
    pickup_terminal: pickupTerminal,
    pickup_adres: pickupAdres,
    klant_naam: klantNaam,
    klant_adres: klantAdres,
    klant_postcode: klantPostcode,
    klant_plaats: klantPlaats,
    dropoff_terminal: dropoffTerminal,
    dropoff_adres: dropoffAdres,
    colli,
    lading,
    gewicht,
    zegelnummer,
    opdrachtgeverNaam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
    opdrachtgeverAdres: 'WOLGAWEG 3',
    opdrachtgeverPostcode: '3198 LR',
    opdrachtgeverPlaats: 'ROTTERDAM',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781'
  };

  // 14) Terminal lookups & locaties-array
  const pickupInfo  = await getTerminalInfoMetFallback(pickupTerminal)  || {};
  const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal) || {};

  data.locaties = [
    {
      volgorde: '0', actie: 'Opzetten',
      naam: pickupInfo.naam || pickupTerminal, adres: pickupInfo.adres || pickupAdres,
      postcode: pickupInfo.postcode || '', plaats: pickupInfo.plaats || '',
      land: pickupInfo.land || 'NL', portbase_code: pickupInfo.portbase_code || '',
      bicsCode: pickupInfo.bicsCode || ''
    },
    {
      volgorde: '0', actie: 'Lossen',
      naam: klantNaam, adres: klantAdres, postcode: klantPostcode,
      plaats: klantPlaats, land: 'NL'
    },
    {
      volgorde: '0', actie: 'Afzetten',
      naam: dropoffInfo.naam || dropoffTerminal, adres: dropoffInfo.adres || dropoffAdres,
      postcode: dropoffInfo.postcode || '', plaats: dropoffInfo.plaats || '',
      land: dropoffInfo.land || 'NL', portbase_code: dropoffInfo.portbase_code || '',
      bicsCode: dropoffInfo.bicsCode || ''
    }
  ];

  console.log('📍 locaties:', JSON.stringify(data.locaties, null, 2));
  console.log('✅ Eindresultaat data object:', JSON.stringify(data, null, 2));
  return data;
}