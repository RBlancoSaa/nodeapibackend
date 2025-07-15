// parsers/parseDFDS.js
import '../utils/fsPatch.js';
import { Buffer } from 'buffer';
import PDFParser from 'pdf2json';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

function extractLinesPdf2Json(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataError', err => reject(err.parserError));
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


// ─── 2) Fallback: PDF → plain‐text → lijnen met pdf-parse ─────────────────
async function extractLinesPdfParse(buffer) {
  const { text } = await pdfParse(buffer);
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

// ─── HELPERS MET DEBUG-LOGS ────────────────────────────────────────────────
function safeMatch(pattern, text, group = 1) {
  const m = typeof text==='string' && text.match(pattern);
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
  // VALIDATIE
  if (!pdfBuffer || !(Buffer.isBuffer(pdfBuffer) || pdfBuffer instanceof Uint8Array)) {
    console.warn('❌ Ongeldige PDF-buffer');
    return {};
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF-buffer te klein');
    return {};
  }

  // 1) Probeer eerst pdf2json...
  let splitLines = [];
  try {
    splitLines = await extractLinesPdf2Json(pdfBuffer);
    console.log('ℹ️ extractLinesPdf2Json:', splitLines.slice(0,20));
  } catch (_) {
    console.warn('⚠️ pdf2json mislukte, fallback naar pdf-parse');
    splitLines = await extractLinesPdfParse(pdfBuffer);
    console.log('ℹ️ extractLinesPdfParse:', splitLines.slice(0,20));
  }

  // ─── PLAATS HET FILTER-BLOK HIER ─────────────────────────────────────────
  const headerPatterns = [
    /^DFDS Warehousing Rotterdam B\.V\./i,
    /^P\.O\. Box/i,
    /^KvK nr\./i,
    /^BTW nr\./i,
    /^Operations/i,
    /^Accounts/i,
    /^Rabobank - EUR/i,
    /^www\.dfds\.com$/i
  ];
  const footerPatterns = [
    /^Al onze offertes en werkzaamheden/i,
    /^Voorts zijn van toepassing de TLN Algemene/i,
    /^Goederen liggen voor rekening en risico/i,
    /^All quotations and services are subject/i,
    /^Goods are stored for account and risk/i
  ];

// TOEVOEGINGEN KOMEN HIER -- 
const ritnummer = findFirst(/\b(SFIM\d{7})\b/i, splitLines) || '';
const bootnaam = findFirst(/Vaartuig\s+(.+?)\s+Reis/i, splitLines);
const rederij = findFirst(/Rederij\s+(.+?)(\s+|$)/i, splitLines);


  splitLines = splitLines.filter(line =>
    !headerPatterns.some(re => re.test(line)) &&
    !footerPatterns.some(re => re.test(line))
  );
  console.log(`ℹ️ Na filteren kop/voettekst: ${splitLines.length} regels over`);

  if (!splitLines.length) {
    console.error('❌ Geen regels uit PDF gehaald');
    return {};
  }

    // 2) Vind secties
  const idxTransportInfo = splitLines.findIndex(r =>
  /^(Transport informatie|Transport information)/i.test(r)
  );
  const idxGoederenInfo = splitLines.findIndex(r =>
    /^(Goederen informatie|Goods information)/i.test(r)
  );
    let transportLines = [];
  if (idxTransportInfo >= 0 && idxGoederenInfo > idxTransportInfo) {
    transportLines = splitLines.slice(idxTransportInfo + 1, idxGoederenInfo);
  } else {
    const contIdx = splitLines.findIndex(r => /[A-Z]{3}U\d{7}/.test(r));
    if (contIdx !== -1) {
      transportLines = splitLines.slice(
        Math.max(0, contIdx - 1),
        contIdx + 2
      );
    }
  }
    const goederenLines = (idxGoederenInfo >= 0)
    ? splitLines.slice(idxGoederenInfo + 1)
    : [];

  console.log('🛠 transportLines:', transportLines);

  // 3) Containernummer (3 letters + U + 7 cijfers)
  const containernummer = findFirst(/([A-Z]{3}U\d{7})/, transportLines);

  // 4) Containertype
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
    console.error('❌ Containertype ontbreekt');
    return {};
  }
  console.log(`🔍 containertypeRaw: '${containertypeRaw}'`);

  // 5) Normaliseer & code ophalen
  const normType = containertypeRaw.toLowerCase().replace(/[^a-z0-9]/g,'');
  let containertypeCode = '0';
  try {
    containertypeCode = await getContainerTypeCode(normType);
  } catch(e) {
    console.warn('⚠️ typeCode-fetch faalde:', e);
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

const containersData = [];

for (let i = 0; i < splitLines.length; i++) {
  const line = splitLines[i];
  const match = line.match(/([A-Z]{4}U\d{7})\s+([0-9]{2,3}ft\s?-?\s?[A-Za-z]{0,3})\s*-\s*([\d.,]+)\s*m3.*Zegel[:\s]*([A-Z0-9]+)/i);

  if (match) {
    const [
      _full,
      containernummer,
      containertypeRaw,
      volumeRaw,
      zegelnummer
    ] = match;

    const volgendeRegel = splitLines[i + 1] || '';
    const gewicht = safeMatch(/([\d.,]+)\s*kg/i, volgendeRegel).replace(',', '.') || '';
    const colli = safeMatch(/(\d+)\s*(?:carton|colli|pcs)/i, volgendeRegel) || '';
    const lading = findFirst(/(?:\d+\s+(?:carton|colli|pcs)\s+)?([A-Za-z0-9\-\s]+)/i, [volgendeRegel]) || '';

    const normType = containertypeRaw.toLowerCase().replace(/[^a-z0-9]/g,'');
    const containertypeCode = await getContainerTypeCode(normType);

  containersData.push({
      ritnummer: ritnummer,
      inleverBootnaam: bootnaam,
      inleverRederij: rederij,

      containernummer,
      containertype: containertypeRaw,
      containertypeCode: containertypeCode || '0',
      volume: volumeRaw.replace(',', '.'),
      laadreferentie: pickupReferentie || '',
      inleverreferentie: lossenReferentie || '',
      datum,
      tijd: tijd ? `${tijd}:00` : '',
      tijdTM: '',

      klantnaam: klantNaam,
      klantadres: klantAdres,
      klantpostcode: klantPostcode,
      klantplaats: klantPlaats,

      colli: colli || '',
      lading: lading,
      gewicht: gewicht || '',
      zegelnummer,
      temperatuur: '0',
      adr: /ADR|IMO|UN[ -]?NR/i.test(volgendeRegel + line) ? 'Waar' : '',

      opdrachtgeverNaam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
      opdrachtgeverAdres: 'WOLGAWEG 3',
      opdrachtgeverPostcode: '3198 LR',
      opdrachtgeverPlaats: 'ROTTERDAM',
      opdrachtgeverTelefoon: '010-1234567',
      opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
      opdrachtgeverBTW: 'NL007129099B01',
      opdrachtgeverKVK: '24232781',

      meldtijd: '',
      instructies: '',

      locaties: [
        {
          volgorde: '0',
          actie: 'Opzetten',
          naam: pickupInfo.naam || pickupTerminal,
          adres: pickupInfo.adres || pickupAdres,
          postcode: pickupInfo.postcode || '',
          plaats: pickupInfo.plaats || '',
          land: pickupInfo.land || 'NL',
          voorgemeld: pickupInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
          aankomst_verw: '',
          tijslot_van: '',
          tijslot_tm: '',
          portbase_code: pickupInfo.portbase_code || '',
          bicsCode: pickupInfo.bicsCode || ''
        },
        {
          volgorde: '0',
          actie: fromNL ? 'Laden' : 'Lossen',
          naam: klantNaam,
          adres: klantAdres,
          postcode: klantPostcode,
          plaats: klantPlaats,
          land: 'NL'
        },
        {
          volgorde: '0',
          actie: 'Afzetten',
          naam: dropoffInfo.naam || dropoffTerminal,
          adres: dropoffInfo.adres || dropoffAdres,
          postcode: dropoffInfo.postcode || '',
          plaats: dropoffInfo.plaats || '',
          land: dropoffInfo.land || 'NL',
          voorgemeld: dropoffInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
          aankomst_verw: '',
          tijslot_van: '',
          tijslot_tm: '',
          portbase_code: dropoffInfo.portbase_code || '',
          bicsCode: dropoffInfo.bicsCode || ''
        }
      ]
    });
  }
}

  // 16) DEBUG LOGS
  console.log('📍 Locations array (orderSequence/actionName/locationName/...):\n', JSON.stringify(locations, null, 2));
  console.log('✅ Complete data object ready for XML generation:\n', JSON.stringify(data, null, 2));

  // 17) RETURN DATA
  return containersData;
}