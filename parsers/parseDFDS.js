// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import PDFParser from 'pdf2json';
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
          const text = decodeURIComponent(item.R[0].T).trim();
          const y = item.y.toFixed(2);
          if (!linesMap.has(y)) linesMap.set(y, []);
          linesMap.get(y).push(text);
        }
      }
      const sorted = [...linesMap.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
      const regels = sorted.map(([_, woorden]) => woorden.join(' ').trim());
      resolve(regels);
    });
    pdfParser.parseBuffer(buffer);
  });
}

function log(label, val) {
  console.log(`🔍 ${label}:`, val || '[LEEG]');
  return val;
}

function formatTijd(t) {
  const m = t.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}:00` : '';
}

function parseKg(val) {
  const m = val.match(/([\d.,]+)\s*kg/i);
  return m ? m[1].replace(',', '.').replace('.', '') : '';
}

export default async function parseDFDS(buffer) {
  const regels = await extractLinesPdf2Json(buffer);
  const data = {};

  // Hardcoded opdrachtgever
  data.opdrachtgeverNaam = 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.';
  data.opdrachtgeverAdres = 'WOLGAWEG 3';
  data.opdrachtgeverPostcode = '3198 LR';
  data.opdrachtgeverPlaats = 'ROTTERDAM';
  data.opdrachtgeverTelefoon = '010-1234567';
  data.opdrachtgeverEmail = 'nl-rtm-operations@dfds.com';
  data.opdrachtgeverBTW = 'NL007129099B01';
  data.opdrachtgeverKVK = '24232781';

  // Ritnummer
  data.ritnummer = log('ritnummer', regels.find(r => r.includes('Onze referentie'))?.match(/SFIM\d{7}/)?.[0] || '');

  // Bootnaam en rederij
  data.bootnaam = log('bootnaam', regels.find(r => r.includes('Vaartuig'))?.split('Vaartuig')[1]?.split('Reis')[0]?.trim() || '');
  data.rederij = log('rederij', regels.find(r => r.includes('Rederij'))?.split('Rederij')[1]?.trim() || '');
  data.inleverBootnaam = data.bootnaam;
  data.inleverRederij = data.rederij;

// Containerregel en zegel
const containerLine = regels.find(r => r.match(/\b[A-Z]{4}\d{7}\b.*Zegel/i));
const containerMatch = containerLine?.match(/([A-Z]{4}\d{7})\s+(.+?)\s*-\s*([\d.]+)\s*m3.*Zegel:\s*(\S+)/i);

data.containernummer = log('containernummer', containerMatch?.[1] || '');

const containertypeRaw = containerMatch?.[2]?.trim() || ''; // ✅ eerst definiëren
data.containertypeOmschrijving = containertypeRaw;           // ❗️omschrijving bewaren
data.containertype = log('containertype', await getContainerTypeCode(containertypeRaw)); // dan gebruiken

data.cbm = log('cbm', containerMatch?.[3] || '0');
data.zegel = log('zegel', containerMatch?.[4] || '');

  // Lading, gewicht, colli
  const goodsLine = regels.find(r => r.match(/\d+\s+\w+\s+RECHARGEABLE/i));
  data.colli = log('colli', goodsLine?.match(/^(\d+)/)?.[1] || '0');
  data.lading = log('lading', goodsLine?.replace(/^\d+\s+\w+\s+/, '')?.replace(/\s+\d+[\.,]\d+\s*kg.*$/, '') || '');
  const gewichtLine = regels.find(r => r.includes('kg'));
  data.brutogewicht = log('brutogewicht', parseKg(gewichtLine || '') || '0');
  data.geladenGewicht = data.brutogewicht;
  data.tarra = '0';
  data.brix = '0';

  // Pickup info
  const pickupBlok = regels.find(r => r.startsWith('Pickup'));
  data.laadreferentie = log('laadreferentie', pickupBlok?.match(/Reference:?\s*(\S+)/i)?.[1] || '');
  data.datum = log('datum', pickupBlok?.match(/(\d{2}-\d{2}-\d{4})/)?.[1] || '');
  data.tijd = log('tijd', formatTijd(regels.find(r => r.includes('Lossen')) || ''));

  // Lossen + Dropoff referentie
  data.inleverreferentie = log('inleverreferentie', regels.find(r => r.startsWith('Lossen'))?.split(' ')[1] || '');
  data.referentie = log('referentie', regels.find(r => r.startsWith('Dropoff'))?.split(' ')[1] || '');

  // ADR
  data.adr = log('adr', /ADR/i.test(regels.join(' ')) ? 'Waar' : 'Onwaar');

  // Instructies, tar, documentatie
  data.instructies = '';
  data.tar = '';
  data.documentatie = '';
  data.inleverBestemming = '';

  // Laden of Lossen
  data.ladenOfLossen = log('ladenOfLossen', pickupBlok?.includes('NL') ? 'Laden' : 'Lossen');

  // Locaties ophalen en Supabase fallback
  const pickupNaam = regels.find(r => r.startsWith('Pickup'))?.replace('Pickup ', '')?.trim();
  const pickupAdres = regels[regels.indexOf(regels.find(r => r.startsWith('Pickup'))) + 1]?.trim();
  const lossenNaam = regels.find(r => r.startsWith('Lossen'))?.replace('Lossen ', '')?.trim();
  const lossenAdres = regels[regels.indexOf(regels.find(r => r.startsWith('Lossen'))) + 1]?.trim();
  const dropoffNaam = regels.find(r => r.startsWith('Dropoff'))?.replace('Dropoff ', '')?.trim();
  const dropoffAdres = regels[regels.indexOf(regels.find(r => r.startsWith('Dropoff'))) + 1]?.trim();

  const locatie1 = await getTerminalInfoMetFallback(`${pickupNaam} ${pickupAdres}`);
  const locatie2 = await getTerminalInfoMetFallback(`${lossenNaam} ${lossenAdres}`);
  const locatie3 = await getTerminalInfoMetFallback(`${dropoffNaam} ${dropoffAdres}`);

  data.locaties = [
    {
      volgorde: '0',
      actie: 'Opzetten',
      naam: locatie1.naam || pickupNaam,
      adres: locatie1.adres || pickupAdres,
      postcode: locatie1.postcode || '',
      plaats: locatie1.plaats || '',
      land: 'NL',
      portbase_code: locatie1.portbase_code || '',
      bicsCode: locatie1.bicsCode || ''
    },
    {
      volgorde: '0',
      actie: 'Lossen',
      naam: locatie2.naam || lossenNaam,
      adres: locatie2.adres || lossenAdres,
      postcode: locatie2.postcode || '',
      plaats: locatie2.plaats || '',
      land: 'NL',
      portbase_code: locatie2.portbase_code || '',
      bicsCode: locatie2.bicsCode || ''
    },
    {
      volgorde: '0',
      actie: 'Afzetten',
      naam: locatie3.naam || dropoffNaam,
      adres: locatie3.adres || dropoffAdres,
      postcode: locatie3.postcode || '',
      plaats: locatie3.plaats || '',
      land: 'NL',
      portbase_code: locatie3.portbase_code || '',
      bicsCode: locatie3.bicsCode || ''
    }
  ];

console.log('➡️ Naar XML-generator:', JSON.stringify(data, null, 2));

  return data;
}