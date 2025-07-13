// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getRederijNaam,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

function log(label, val) {
  console.log(`🔍 ${label}:`, val || '[LEEG]');
  return val;
}

export default async function parseDFDS(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return { ritnummer: '0', containers: [] };

  const parsed = await pdfParse(buffer);
  const text = parsed.text;
  const regels = text.split('\n').map(l => l.trim()).filter(Boolean);

  const ritnummer = log('ritnummer', (text.match(/\bSFIM\d{7}\b/i) || [])[0] || '0');

  // ⛓️ Terminal-info ophalen (vast voor alle containers)
  const pickupTerminalKey = (text.match(/Pickup (.+)/i) || [])[1]?.trim();
  const dropoffTerminalKey = (text.match(/Dropoff (.+)/i) || [])[1]?.trim();

  const pickupTerminal = await getTerminalInfoMetFallback(pickupTerminalKey || '');
  const dropoffTerminal = await getTerminalInfoMetFallback(dropoffTerminalKey || '');

  const klant = {
    naam: 'TIARO',
    adres: 'CHRIS BEMEKERSLAAN 2',
    postcode: '3061 EA',
    plaats: 'ROTTERDAM'
  };

  // 📦 Containers detecteren
  const containers = [];
  const containerBlokken = text.split(/\n(?=[A-Z]{4}U?\d{6,7})/g);

  for (const blok of containerBlokken) {
    const containerNr = (blok.match(/\b([A-Z]{4}U?\d{6,7})\b/) || [])[1] || '';
    if (!containerNr) continue;

    const containertype = (blok.match(/20ft.*?33,2 m³/) || [])[0] || '';
    const gewicht = (blok.match(/([\d.]+)\s*kg/) || [])[1]?.replace(',', '.') || '0';
    const lading = (blok.match(/[A-Z ]+\(UL\)/i) || [])[0]?.trim() || '';
    const seal = (blok.match(/Zegel: (\d+)/i) || [])[1] || '';

    const containertypeCode = await getContainerTypeCode(containertype);

    containers.push({
      ritnummer,
      referentie: (blok.match(/Lossen\s+(\d{8})/) || [])[1] || '',
      containernummer: containerNr,
      containertype,
      containertypeCode,
      lading,
      colli: '0',
      gewicht,
      volume: '0',
      temperatuur: '0',
      laadreferentie: '',
      datum: '14-7-2025',
      tijd: '06:30:00',
      instructies: '',
      adr: 'Onwaar',
      rederij: 'MSC',
      bootnaam: 'MSC CORUNA',
      inleverBootnaam: '',
      inleverRederij: 'MSC',
      inleverreferentie: (blok.match(/Dropoff\s+([A-Z0-9]+)/) || [])[1] || '',
      inleverBestemming: 'Medrepair Nederland',

      pickupTerminal: pickupTerminalKey || '',
      dropoffTerminal: dropoffTerminalKey || '',
      terminal: dropoffTerminal.naam || '',
      rederijCode: '0',

      klantnaam: klant.naam,
      klantadres: klant.adres,
      klantpostcode: klant.postcode,
      klantplaats: klant.plaats,

      locaties: [
        {
          volgorde: '0',
          actie: 'Opzetten',
          naam: pickupTerminal.naam || '',
          adres: pickupTerminal.adres || '',
          postcode: pickupTerminal.postcode || '',
          plaats: pickupTerminal.plaats || '',
          land: 'NL',
          voorgemeld: pickupTerminal.voorgemeld === 'ja' ? 'Waar' : 'Onwaar',
          portbase_code: pickupTerminal.portbase_code || '',
          bicsCode: pickupTerminal.bicsCode || '',
          aankomst_verw: '',
          tijslot_van: '',
          tijslot_tm: ''
        },
        {
          volgorde: '0',
          actie: 'Lossen',
          naam: klant.naam,
          adres: klant.adres,
          postcode: klant.postcode,
          plaats: klant.plaats,
          land: 'NL'
        },
        {
          volgorde: '0',
          actie: 'Afzetten',
          naam: dropoffTerminal.naam || '',
          adres: dropoffTerminal.adres || '',
          postcode: dropoffTerminal.postcode || '',
          plaats: dropoffTerminal.plaats || '',
          land: 'NL',
          voorgemeld: dropoffTerminal.voorgemeld === 'ja' ? 'Waar' : 'Onwaar',
          portbase_code: dropoffTerminal.portbase_code || '',
          bicsCode: dropoffTerminal.bicsCode || '',
          aankomst_verw: '',
          tijslot_van: '',
          tijslot_tm: ''
        }
      ]
    });
  }

  return { ritnummer, containers };
}
