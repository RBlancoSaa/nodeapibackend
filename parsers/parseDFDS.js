// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import { getTerminalInfoMetFallback, getContainerTypeCode } from '../utils/lookups/terminalLookup.js';

function log(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value || '';
}

function formatDatum(d) {
  const [dd, mm, yyyy] = d.split('-');
  return `${parseInt(dd)}-${parseInt(mm)}-${yyyy}`;
}

export default async function parseDFDS(buffer) {
  const parsed = await pdfParse(buffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

  const ritnummer = log('ritnummer', text.match(/\bSFIM\d{7}\b/i)?.[0] || '');

  const bootnaam = log('bootnaam', text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1] || '');
  const rederij = log('rederij', text.match(/Rederij\s+(.+)/i)?.[1] || '');
  const containerrijen = regels.filter(r => r.match(/\b[A-Z]{4}\d{7}\b.*Zegel:/));

  const containers = [];

  for (const regel of containerrijen) {
    const match = regel.match(/([A-Z]{4}\d{7})\s+(.+?)\s*-\s*([\d.]+)\s*m3.*Zegel:\s*(\S+)/i);
    if (!match) continue;

    const containernummer = log('containernummer', match[1]);
    const containertypeRaw = match[2].trim();
    const cbm = log('cbm', match[3]);
    const zegel = log('zegel', match[4]);

    const containertypeCode = await getContainerTypeCode(containertypeRaw);

    const pickupLine = regels.find(r => r.startsWith('Pickup'));
    const laadreferentie = log('laadreferentie', pickupLine?.match(/Reference:?\s*(\S+)/i)?.[1] || '');

    const datumLine = regels.find(r => r.match(/\d{2}-\d{2}-\d{4}/));
    let datum = '';
    if (datumLine) {
      const match = datumLine.match(/(\d{2}-\d{2}-\d{4})/);
      datum = match ? formatDatum(match[1]) : '';
    }
    if (!datum) {
      const uploadDate = new Date();
      datum = `${uploadDate.getDate()}-${uploadDate.getMonth() + 1}-${uploadDate.getFullYear()}`;
      console.warn('⚠️ Geen datum gevonden in PDF, uploaddatum gebruikt.');
    }

    const tijdLine = regels.find(r => r.includes('Lossen'));
    const tijd = tijdLine?.match(/\b\d{2}:\d{2}\b/)?.[0] || '';
    const tijdMetSeconden = tijd ? `${tijd}:00` : '';

    const referentie = log('referentie', regels.find(r => r.startsWith('Lossen'))?.split(' ')[1] || '');
    const inleverreferentie = log('inleverreferentie', regels.find(r => r.includes('Dropoff'))?.split(' ')[1] || '');

    // Klantlocatie = Lossen-adres
    const klantnaam = log('klantnaam', 'DFDS Warehousing Rotterdam BV');
    const klantadres = log('klantadres', 'Wolgaweg 5');
    const klantpostcode = log('klantpostcode', '3198 LR');
    const klantplaats = log('klantplaats', 'Rotterdam');

    const dropoffTerminalNaam = 'EMX Euromax Terminal'; // of uit PDF halen indien nodig
    const dropoffTerminal = await getTerminalInfoMetFallback(dropoffTerminalNaam);

    const data = {
      ritnummer,
      ladenOfLossen: 'Laden',
      datum,
      tijd: tijdMetSeconden,
      containernummer,
      containertype: containertypeCode || '',
      containertypeOmschrijving: containertypeRaw,
      cbm,
      zegel,
      referentie,
      laadreferentie,
      lading: '',
      adr: 'Onwaar',
      tarra: '0',
      geladenGewicht: '0',
      brutogewicht: '0',
      colli: '0',
      temperatuur: '',
      brix: '0',
      documentatie: '',
      tar: '',
      bootnaam,
      rederij,
      inleverBootnaam: bootnaam,
      inleverBestemming: '',
      inleverRederij: rederij,
      inleverreferentie,
      instructies: '',
      opdrachtgeverNaam: 'DFDS Warehousing Rotterdam BV',
      opdrachtgeverAdres: 'Wolgaweg 5, 3198 LR Rotterdam - Europoort, THE NETHERLANDS',
      opdrachtgeverPostcode: '3198 LR',
      opdrachtgeverPlaats: 'ROTTERDAM',
      opdrachtgeverTelefoon: '010-1234567',
      opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
      opdrachtgeverBTW: 'NL007129099B01',
      opdrachtgeverKVK: '24232781',
      klantnaam,
      klantBedrijf: klantnaam,
      klantadres,
      klantpostcode,
      klantplaats,
      locaties: [
        {
          volgorde: '0',
          actie: 'Opzetten',
          naam: dropoffTerminal.naam || dropoffTerminalNaam,
          adres: dropoffTerminal.adres || '',
          postcode: dropoffTerminal.postcode || '',
          plaats: dropoffTerminal.plaats || '',
          land: 'NL',
          portbase_code: dropoffTerminal.portbase_code || '',
          bicsCode: dropoffTerminal.bicsCode || ''
        },
        {
          volgorde: '0',
          actie: 'Lossen',
          naam: klantnaam,
          adres: klantadres,
          postcode: klantpostcode,
          plaats: klantplaats,
          land: 'NL'
        },
        {
          volgorde: '0',
          actie: 'Afzetten',
          naam: dropoffTerminal.naam || dropoffTerminalNaam,
          adres: dropoffTerminal.adres || '',
          postcode: dropoffTerminal.postcode || '',
          plaats: dropoffTerminal.plaats || '',
          land: 'NL',
          portbase_code: dropoffTerminal.portbase_code || '',
          bicsCode: dropoffTerminal.bicsCode || ''
        }
      ]
    };

    containers.push(data);
  }

  if (containers.length === 0) {
    throw new Error('❌ Geen containers gevonden in DFDS-opdracht.');
  }

  return containers;
}