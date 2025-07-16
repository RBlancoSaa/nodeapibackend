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
      const allObjects = [];

      for (const page of pdf.Pages) {
        for (const item of page.Texts) {
          const text = decodeURIComponent(item.R[0].T).trim();
          const x = item.x;
          const y = item.y;
          if (text) allObjects.push({ text, x, y });
        }
      }
console.log('🔍 Totaal tekstobjecten:', allObjects.length);
console.log('📌 Y-ranges voorbeeld:', allObjects.slice(0, 10).map(o => o.y));
      // 📌 FILTER: alleen regels tussen 100 en 700 op Y-coördinaat
      const inhoudsregels = allObjects
        .sort((a, b) => b.y - a.y || a.x - b.x)
        .map(obj => obj.text);

      resolve(inhoudsregels);
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
  const bekendeVoetteksten = [
  'FENEX',
  'TLN Algemene Betalingsvoorwaarden',
  'All quotations and services are subject',
  'Opdrachtgever dient zelf voor verzekering'
];
const voettekstregels = splitLines.slice(-20).filter(isVoettekst);
console.log('🧹 Voettekstregels verwijderd:', voettekstregels);
const isVoettekst = (line) =>
  bekendeVoetteksten.some(fragment => line.toLowerCase().includes(fragment.toLowerCase()));

splitLines = splitLines.filter((line, idx, arr) =>
  !(idx >= arr.length - 20 && isVoettekst(line))
);
  console.log('📄 Eerste 10 regels PDF:', splitLines.slice(0, 10));
} catch {
  const { text } = await pdfParse(pdfBuffer);
  splitLines = text.split('\n').map(l => l.trim()).filter(Boolean);
}

if (splitLines.length < 5) {
  console.warn('⚠️ SplitLines te leeg na filtering');
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
  const containerMatch = line.match(/[A-Z]{4}U\d{7}/);
  if (!containerMatch) continue;

  const containernummer = containerMatch[0];
  const context = splitLines.slice(i, i + 6).join(' ');

  const containertypeRaw = safeMatch(/(\d{2,3}ft\s*HC?)/i, context);
  const containertypeCode = await getContainerTypeCode(containertypeRaw?.toLowerCase().replace(/[^a-z0-9]/g, '') || '');
  const volumeRaw = safeMatch(/([\d.,]+)\s*m3/i, context).replace(',', '.');
  const zegelnummer = safeMatch(/Zegel[:\s]*([A-Z0-9]+)/i, context);
  const gewichtRaw = safeMatch(/([\d.,]+)\s*(?:kg|KG)/i, context).replace(',', '.');

  if (!gewichtRaw || parseFloat(gewichtRaw) <= 0) {
    console.warn(`❌ Gewicht ontbreekt of is 0 voor container ${containernummer}`);
    continue;
  }

  const colli = safeMatch(/(\d+)\s*(?:carton|colli|pcs)/i, context) || '0';
  const lading = safeMatch(/Omschrijving\s+([A-Z0-9\s\-]{5,})/i, context) || '';
  const adr = /ADR|IMO|UN[ -]?NR/i.test(context) ? 'Waar' : '';

  let datum = '';
  const datumMatch = context.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/) || context.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (datumMatch) {
    if (datumMatch[3].length === 4) {
      datum = `${parseInt(datumMatch[1])}-${parseInt(datumMatch[2])}-${datumMatch[3]}`;
    } else {
      datum = `${parseInt(datumMatch[3])}-${parseInt(datumMatch[2])}-${datumMatch[1]}`;
    }
  }

  const tijdMatch = context.match(/(\d{2}:\d{2})/);
  const tijd = tijdMatch ? `${tijdMatch[1]}:00` : '';


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
 if (containersData.length === 0) {
    console.warn(`⚠️ Geen containers gevonden in DFDS-opdracht (ritnummer: ${ritnummer})`);
    console.warn('🔍 Alle regels:', splitLines);
  }

  return containersData;
}