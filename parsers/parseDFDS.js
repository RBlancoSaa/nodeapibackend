// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import { getTerminalInfoMetFallback, getContainerTypeCode } from '../utils/lookups/terminalLookup.js';

function log(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value || '';
}

export default async function parseDFDS(pdfBuffer) {
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

  const ritnummer = log('ritnummer', text.match(/\bSFIM\d{7}\b/i)?.[0] || '');
  const bootnaam = log('bootnaam', text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1] || '');
  const rederij = log('rederij', text.match(/Rederij\s+(.+)/i)?.[1]?.trim() || '');
  const containernummers = regels.filter(r => r.match(/\b[A-Z]{4}\d{7}\b/));

  const containers = [];

  for (const regel of containernummers) {
    const match = regel.match(/([A-Z]{4}\d{7})\s+(.+?)\s+-\s+([\d.]+)\s*m3.*Zegel:\s*(\S+)/i);
    if (!match) continue;

    const containernummer = match[1];
    const containertypeOmschrijving = match[2].trim();
    const cbm = match[3].replace(',', '.');
    const zegel = match[4];
    const containertypeCode = await getContainerTypeCode(containertypeOmschrijving);

    // Referentie en tijdregels
    const lossenregel = regels.find(r => r.startsWith('Lossen'));
    const referentie = log('referentie', lossenregel?.split(' ')[1] || '');
    const tijdMatch = lossenregel?.match(/(\d{2}:\d{2})/);
    const tijd = log('tijd', tijdMatch ? `${tijdMatch[1]}:00` : '');

    const laadreferentie = log('laadreferentie', regels.find(r => r.startsWith('Pickup'))?.match(/Reference:?\s*(\S+)/i)?.[1] || '');
    const pickupDatumMatch = regels.find(r => r.match(/\d{2}-\d{2}-\d{4}/))?.match(/(\d{2})-(\d{2})-(\d{4})/);
    let datum = '';
    if (pickupDatumMatch) {
      datum = `${parseInt(pickupDatumMatch[1])}-${parseInt(pickupDatumMatch[2])}-${pickupDatumMatch[3]}`;
    } else {
      const today = new Date();
      datum = `${today.getDate()}-${today.getMonth() + 1}-${today.getFullYear()}`;
      console.warn('⚠️ Geen datum gevonden, fallback gebruikt:', datum);
    }

    const klant = {
      naam: 'DFDS Warehousing Rotterdam BV',
      adres: 'Wolgaweg 5',
      postcode: '3198 LR',
      plaats: 'ROTTERDAM',
      land: 'NL'
    };

    const locatie1 = await getTerminalInfoMetFallback('DFDS Warehousing Rotterdam BV Europoort');
    const locatie3 = await getTerminalInfoMetFallback('DFDS Warehousing Rotterdam BV Europoort');

    const data = {
      ritnummer,
      bootnaam,
      rederij,
      inleverBootnaam: bootnaam,
      inleverRederij: rederij,
      containernummer,
      containertype: containertypeCode,
      containertypeOmschrijving,
      cbm,
      zegel,
      referentie,
      tijd,
      datum,
      laadreferentie,
      lading: '',
      adr: '',
      tarra: '0',
      geladenGewicht: '0',
      brutogewicht: '0',
      colli: '0',
      temperatuur: '',
      brix: '0',
      documentatie: '',
      tar: '',
      inleverreferentie: referentie,
      inleverBestemming: '',
      instructies: pickupDatumMatch ? '' : 'DATUM STAAT VERKEERD',

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
          actie: 'Lossen',
          naam: klant.naam,
          adres: klant.adres,
          postcode: klant.postcode,
          plaats: klant.plaats,
          land: klant.land
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
      ],

      ladenOfLossen: containernummer ? 'Lossen' : 'Laden'
    };

    containers.push(data);
  }

  if (containers.length === 0) {
    console.warn('⚠️ Geen containers gevonden in DFDS-opdracht.');
  }

  return containers;
}