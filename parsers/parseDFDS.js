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
  } catch {
    const { text } = await pdfParse(pdfBuffer);
    splitLines = text.split('\n').map(l => l.trim()).filter(Boolean);

   // Filter bekende kop- en voettekst regels weg
  splitLines = splitLines.filter(line =>
    !/^Al onze offertes en werkzaamheden geschieden uitsluitend/i.test(line) &&
    !/^Voorts zijn van toepassing de TLN/i.test(line) &&
    !/^Goederen liggen voor rekening/i.test(line) &&
    !/^Opdrachtgever dient zelf voor verzekering/i.test(line) &&
    !/^TRANSPORT TO BE CHARGED WITH/i.test(line) &&
    !/^Datum\s+\d{2}-\d{2}-\d{4}/i.test(line)
  );
    }

  const startIndex = splitLines.findIndex(line => /Zendinggegevens/i.test(line));
  const endIndex = splitLines.findIndex(line =>
    /TRANSPORT TO BE CHARGED WITH|^Datum\s+\d{2}-\d{2}-\d{4}/i.test(line)
  );

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    splitLines = splitLines.slice(startIndex + 1, endIndex);
  } else {
    console.warn('⚠️ Kon inhoudsgrenzen niet bepalen, volledige tekst wordt gebruikt');
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

  for (let i = 0; i < splitLines.length; i++) {
    const line = splitLines[i];
      console.log('👉 Regel:', line); // <--- tijdelijk toevoegen
    const match = line.match(/([A-Z]{4}U\d{7})\s+([0-9]{2,3}ft\s?-?\s?[A-Za-z]{0,3})\s*-\s*([\d.,]+)\s*m3.*Zegel[:\s]*([A-Z0-9]+)/i);
    if (match) {
      const [_, containernummer, containertypeRaw, volumeRaw, zegelnummer] = match;
      const volgendeRegel = splitLines[i + 1] || '';
      const gewichtMatch = safeMatch(/([\d.,]+)\s*kg/i, volgendeRegel);
      const gewicht = gewichtMatch.replace(',', '.');
      if (!gewicht || parseFloat(gewicht) <= 0) {
        console.warn(`❌ Gewicht ontbreekt of is 0 voor container ${containernummer}`);
        continue;
      }
      const colli = safeMatch(/(\d+)\s*(?:carton|colli|pcs)/i, volgendeRegel);
      const lading = findFirst(/(?:\d+\s+(?:carton|colli|pcs)\s+)?([A-Za-z0-9\-\s]+)/i, [volgendeRegel]) || '';
      const normType = containertypeRaw.toLowerCase().replace(/[^a-z0-9]/g, '');
      const containertypeCode = await getContainerTypeCode(normType);
      const adr = /ADR|IMO|UN[ -]?NR/i.test(line + volgendeRegel) ? 'Waar' : '';

      const actie = pickupTerminal.toLowerCase().includes('rotterdam') ? 'Laden' : 'Lossen';

      const datumMatch = findFirst(/(\d{1,2})-(\d{1,2})-(\d{4})/, line + volgendeRegel);
      const tijdMatch = findFirst(/(\d{2}:\d{2})/, line + volgendeRegel);
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
            actie,
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