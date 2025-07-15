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

const laatste20 = splitLines.slice(-20);
const isVoettekst = (line) =>
  bekendeVoetteksten.some(fragment => line.toLowerCase().includes(fragment.toLowerCase()));
splitLines = splitLines.filter((line, idx) =>
  !(idx >= splitLines.length - 20 && isVoettekst(line))
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

  for (let i = 0; i < splitLines.length - 3; i++) {
    const regel1 = splitLines[i];
    const regel2 = splitLines[i + 1];
    const regel3 = splitLines[i + 2];
    const regel4 = splitLines[i + 3];
    const fullBlock = `${regel1} ${regel2} ${regel3} ${regel4}`;

    const match = fullBlock.match(/([A-Z]{4}U\d{7})\s+([0-9]{2,3}ft(?:\s?HC)?)\s*[-–—]?\s*([\d.,]+)\s*m3\s*[/\-]?\s*(?:Zegel|Seal)[:\s]*([A-Z0-9]+)/i);
    if (match) {
      const [_, containernummer, containertypeRaw, volumeRaw, zegelnummer] = match;
      const context = splitLines.slice(i, i + 5).join(' ');
      const gewichtMatch = context.match(/([\d.,]+)\s*(?:KG|kg)/i);
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

      const datumMatch = context.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/) || context.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        let datum = '';
        if (datumMatch) {
          if (datumMatch[3].length === 4) {
            datum = `${parseInt(datumMatch[1])}-${parseInt(datumMatch[2])}-${datumMatch[3]}`;
          } else {
            datum = `${parseInt(datumMatch[3])}-${parseInt(datumMatch[2])}-${datumMatch[1]}`;
          }
        }
      const tijdMatch = findFirst(/(\d{2}:\d{2})/, fullBlock);
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
  }  if (containersData.length === 0) {
    console.warn(`⚠️ Geen containers gevonden in DFDS-opdracht (ritnummer: ${ritnummer})`);
    console.warn('🔍 Alle regels:', splitLines);
  }

  return containersData;
}