// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

function logResult(label, value) {
  const val = value || '';
  console.log(`🔍 ${label}:`, val);
  return val;
}

export default async function parseDFDS(pdfBuffer) {
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

  // 📌 Algemene info
  const ritnummer = logResult('ritnummer', text.match(/\bSFIM\d{7}\b/)?.[0]);
  const bootnaam = logResult('bootnaam', text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1]);
  const rederij = logResult('rederij', text.match(/Rederij\s+(.+)/i)?.[1]);

  const klantregel = regels.find(r => r.toLowerCase().includes('lossen') || r.toLowerCase().includes('dropoff')) || '';
  const klantNaam = logResult('klant.naam', klantregel.match(/Lossen\s+(.+)/i)?.[1]);
  const klantAdres = logResult('klant.adres', klantregel.match(/Adres[:\s]+(.+)/i)?.[1]);
  const klantPostcode = logResult('klant.postcode', klantregel.match(/Postcode[:\s]+(.+)/i)?.[1]);
  const klantPlaats = logResult('klant.plaats', klantregel.match(/Plaats[:\s]+(.+)/i)?.[1]);

  const locatie1 = await getTerminalInfoMetFallback('DFDS Warehousing Rotterdam BV Europoort');
  const locatie3 = await getTerminalInfoMetFallback('DFDS Warehousing Rotterdam BV Europoort');

  const algemeneData = {
    ritnummer,
    bootnaam,
    rederij,
    inleverBootnaam: bootnaam,
    inleverRederij: rederij,
    opdrachtgeverNaam: 'DFDS Warehousing Rotterdam BV',
    opdrachtgeverAdres: 'Wolgaweg 5, 3198 LR Rotterdam - Europoort, THE NETHERLANDS',
    opdrachtgeverPostcode: '3198 LR',
    opdrachtgeverPlaats: 'ROTTERDAM',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781',
    locaties: [
      {
        volgorde: '0',
        actie: 'Opzetten',
        naam: locatie1.naam,
        adres: locatie1.adres,
        postcode: locatie1.postcode,
        plaats: locatie1.plaats,
        land: locatie1.land,
        portbase_code: locatie1.portbase_code,
        bicsCode: locatie1.bicsCode
      },
      {
        volgorde: '0',
        actie: 'Laden',
        naam: klantNaam,
        adres: klantAdres,
        postcode: klantPostcode,
        plaats: klantPlaats,
        land: 'NL'
      },
      {
        volgorde: '0',
        actie: 'Afzetten',
        naam: locatie3.naam,
        adres: locatie3.adres,
        postcode: locatie3.postcode,
        plaats: locatie3.plaats,
        land: locatie3.land,
        portbase_code: locatie3.portbase_code,
        bicsCode: locatie3.bicsCode
      }
    ]
  };

  // 📦 Containers
  const containers = [];

  for (const regel of regels) {
    const match = regel.match(/\b([A-Z]{4}\d{7})\b\s+(.+?)\s+-\s+([\d.]+)\s*m3.*Zegel:\s*(\S+)/i);
    if (!match) continue;

    const containernummer = logResult('containernummer', match[1]);
    const containertypeRaw = logResult('containertype', match[2]);
    const volume = logResult('volume', match[3].replace(',', '.'));
    const zegel = logResult('zegel', match[4]);
    const containertypeCode = await getContainerTypeCode(containertypeRaw);

    const gewicht = logResult('gewicht', regels.find(r => r.includes('kg'))?.match(/([\d.,]+)\s*kg/i)?.[1]?.replace(',', '.') || '0');
    const lading = logResult('lading', regels.find(r => r.match(/\d+\s*CARTON|BAG|PALLET|BARREL/i)) || '');
    const referentie = logResult('referentie', regels.find(r => r.startsWith('Lossen'))?.split(' ')[1]);
    const tijd = logResult('tijd', regels.find(r => r.match(/\d{2}:\d{2}/))?.match(/(\d{2}:\d{2})/)?.[1] + ':00' || '');

    const datumRaw = regels.find(r => r.match(/\d{2}-\d{2}-\d{4}/))?.match(/(\d{2})-(\d{2})-(\d{4})/);
    const datum = datumRaw ? `${parseInt(datumRaw[1])}-${parseInt(datumRaw[2])}-${datumRaw[3]}` : '';
    const instructies = datum ? '' : 'DATUM STAAT VERKEERD';

    const containerData = {
      containernummer,
      containertype: containertypeCode,
      containertypeOmschrijving: containertypeRaw,
      volume,
      zegel,
      referentie,
      tijd,
      datum,
      laadreferentie: '',
      lading,
      adr: gewicht !== '0' ? 'Waar' : 'Onwaar',
      tarra: '0',
      geladenGewicht: gewicht,
      brutogewicht: gewicht,
      colli: '0',
      temperatuur: logResult('temperatuur', regels.find(r => r.includes('°C'))?.match(/(\d{1,2})/)?.[1] || ''),
      brix: '0',
      documentatie: '',
      tar: '',
      inleverreferentie: referentie,
      inleverBestemming: '',
      instructies,
      ladenOfLossen: 'Lossen'
    };

    containers.push(containerData);
  }

  return { containers, algemeneData };
}