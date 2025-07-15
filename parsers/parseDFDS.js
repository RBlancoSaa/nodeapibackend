// 📁 parsers/parseDFDS.js
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
      const ys = Array.from(linesMap.keys()).map(k => parseFloat(k)).sort((a, b) => b - a);
      const allLines = ys.map(y => {
        const key = y.toFixed(2);
        return linesMap.get(key).sort((a, b) => a.x - b.x).map(run => run.text).join(' ').trim();
      });
      resolve(allLines);
    });
    pdfParser.parseBuffer(buffer);
  });
}

function safeMatch(pattern, text, group = 1) {
  const m = typeof text === 'string' && text.match(pattern);
  return m && m[group] ? m[group].trim() : '';
}

function findFirst(pattern, lines) {
  for (const l of lines) {
    const m = l.match(pattern);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

export default async function parseDFDS(pdfBuffer) {
  if (!pdfBuffer || !(Buffer.isBuffer(pdfBuffer) || pdfBuffer instanceof Uint8Array)) return [];

  let splitLines = [];
try {
  splitLines = await extractLinesPdf2Json(pdfBuffer);
  console.log('📄 Eerste 10 regels PDF:', splitLines.slice(0, 10));
} catch {
  const { text } = await pdfParse(pdfBuffer);
  splitLines = text.split('\n').map(l => l.trim()).filter(Boolean);
}

// Vind duidelijke begin- en eindmarkeringen van de echte opdrachtinhoud
const endIndex = splitLines.findIndex(line =>
  /^TRANSPORT TO BE CHARGED WITH/i.test(line) ||
  /Forwarding Conditions.*District Court.*Rotterdam/i.test(line) ||
  /Voorts zijn van\s+toepassing de TLN Algemene Betalingsvoorwaarden/i.test(line)
);

// Alles vóór die voettekstregel is de opdracht
if (endIndex > 5) {
  splitLines = splitLines.slice(0, endIndex);
} else {
  console.warn('⚠️ Kon eindgrens niet bepalen, volledige tekst wordt gebruikt');
}

  const ritnummerMatch = splitLines.join(' ').match(/\bSFIM\d{7}\b/i);
  const ritnummer = ritnummerMatch ? ritnummerMatch[0] : '';
  const bootnaam = findFirst(/Vaartuig\s+(.+?)\s+Reis/i, splitLines);
  const rederij = findFirst(/Rederij\s+(.+?)(\s+|$)/i, splitLines);
  const pickupTerminal = findFirst(/Pickup\s+(.+)/i, splitLines);
  const dropoffTerminal = findFirst(/Dropoff\s+(.+)/i, splitLines);
  const klantNaam = findFirst(/Lossen\s+([A-Z].+)/i, splitLines);
  const klantAdres = findFirst(/(\d{4}\s?[A-Z]{2})\s+(.+)/, splitLines);
  const klantPostcode = klantAdres?.match(/(\d{4}\s?[A-Z]{2})/)?.[1] || '';
  const klantPlaats = klantAdres?.replace(klantPostcode, '').trim() || '';
  const pickupInfo = await getTerminalInfoMetFallback(pickupTerminal) || {};
  const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal) || {};

  
const containersData = [];

  for (let i = 0; i < splitLines.length - 3; i++) {
    const regel1 = splitLines[i];
    const regel2 = splitLines[i + 1];
    const regel3 = splitLines[i + 2];
    const regel4 = splitLines[i + 3];
    const fullBlock = `${regel1} ${regel2} ${regel3} ${regel4}`;

    const match = fullBlock.match(/([A-Z]{4}U\d{7})\s+([0-9]{2,3}ft(?:\s?HC)?)\s*-\s*([\d.,]+)\s*m3.*Zegel[:\s]*([A-Z0-9]+)/i);
    if (match) {
      const [_, containernummer, containertypeRaw, volumeRaw, zegelnummer] = match;

      const gewichtMatch = fullBlock.match(/([\d.,]+)\s*kg/i);
      const gewicht = gewichtMatch?.[1]?.replace(',', '.') || '';
      if (!gewicht || parseFloat(gewicht) <= 0) {
        console.warn(`❌ Gewicht ontbreekt of is 0 voor container ${containernummer}`);
        continue;
      }

      const colli = safeMatch(/(\d+)\s*(?:carton|colli|pcs)/i, fullBlock);
      const lading = findFirst(/(?:\d+\s+(?:carton|colli|pcs)\s+)?([A-Z0-9\s\-]+)/i, [regel4]);
      const normType = containertypeRaw.toLowerCase().replace(/[^a-z0-9]/g, '');
      const containertypeCode = await getContainerTypeCode(normType);
      const adr = /ADR|IMO|UN[ -]?NR/i.test(fullBlock) ? 'Waar' : '';

      const datumMatch = findFirst(/(\d{1,2})-(\d{1,2})-(\d{4})/, fullBlock);
      const tijdMatch = findFirst(/(\d{2}:\d{2})/, fullBlock);
      const datum = datumMatch ? datumMatch.replace(/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (_, d, m, y) => `${parseInt(d)}-${parseInt(m)}-${y}`) : '';
      const tijd = tijdMatch ? `${tijdMatch}:00` : '';


      containersData.push({
        ritnummer,
        inleverBootnaam: bootnaam,
        inleverRederij: rederij,
        containernummer,
        containertype: containertypeRaw,
        containertypeCode: containertypeCode || '',
        volume: volumeRaw.replace(',', '.'),
        laadreferentie: '',
        inleverreferentie: '',
        datum,
        tijd,
        tijdTM: '',
        klantnaam: klantNaam,
        klantadres: klantAdres,
        klantpostcode: klantPostcode,
        klantplaats: klantPlaats,
        colli: colli || '0',
        lading,
        gewicht,
        zegelnummer,
        temperatuur: '0',
        adr,
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
            actie:'Opzetten',
            naam: pickupInfo.naam || pickupTerminal,
            adres: pickupInfo.adres || '',
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
            actie: 'Lossen',
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
            adres: dropoffInfo.adres || '',
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
if (containersData.length === 0) {
  console.warn(`⚠️ Geen containers gevonden in DFDS-opdracht (ritnummer: ${ritnummer})`);
}
  return containersData;
}