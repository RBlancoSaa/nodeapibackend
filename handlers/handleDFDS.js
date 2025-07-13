// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfo,
  getRederijNaam,
  getContainerTypeCode,
  getTerminalInfoMetFallback
} from '../utils/lookups/terminalLookup.js';

function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}

export default async function parseDFDS(pdfBuffer) {
  console.log('📦 Ontvangen pdfBuffer:', pdfBuffer?.length, 'bytes');
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 100) return {};

  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(l => l.trim()).filter(Boolean);

  const extract = (regex) => {
    const match = text.match(regex);
    return match?.[1]?.trim() || '';
  };

  const extractAll = (regex) => {
    const matches = [...text.matchAll(regex)];
    return matches.map(m => m[1].trim());
  };

  const ritnummer = extract(/\b(SFIM\d{7})\b/i);
  logResult('ritnummer', ritnummer);
  if (!ritnummer) return {};

  const containerBlokken = text.split(/\n(?=\w{4}U?\d{7})/g).filter(b => b.match(/\d{4}U?\d{7}/));
  const containers = [];

  for (const blok of containerBlokken) {
    const regels = blok.split('\n');
    const containernummer = extract(/\b([A-Z]{4}U?\d{7})\b/i);
    const referentie = extract(/Lossen\s+(\S+)/i);
    const datum = extract(/Pickup.*?(\d{2}-\d{2}-\d{4})/i);
    const tijd = extract(/(\d{2}:\d{2})/i);
    const containertype = extract(/20ft\s*-\s*([\d,\.]+)\s*m³/i);
    const gewicht = extract(/(\d{2}\.\d{3},\d{2}|\d{1,3},\d{3})\s*kg/i)?.replace(',', '.');

    const pickupTerminal = extract(/Pickup\s+(.*Terminal.*)/i);
    const dropoffTerminal = extract(/Dropoff\s+(.+)/i);
    const klantlocatie = extract(/Lossen\s+(.*)/i);

    const pickupInfo = await getTerminalInfoMetFallback(pickupTerminal);
    const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal);

    const rederij = extract(/Rederij\s+([A-Z ]+)/i);
    const bootnaam = extract(/Vaartuig\s+(.+?)\s+Reis/i);

    const container = {
      ritnummer: logResult('ritnummer', ritnummer),
      referentie: logResult('referentie', referentie),
      colli: logResult('colli', '0'),
      volume: logResult('volume', '0'),
      gewicht: logResult('gewicht', gewicht || '0'),
      lading: logResult('lading', extract(/Omschrijving\s+(.+)/i) || '0'),
      inleverreferentie: logResult('inleverreferentie', '0'),
      rederij: logResult('rederij', rederij),
      bootnaam: logResult('bootnaam', bootnaam),
      containernummer: logResult('containernummer', containernummer),
      temperatuur: logResult('temperatuur', '0'),
      datum: logResult('datum', datum || new Date().toLocaleDateString('nl-NL')),
      tijd: logResult('tijd', tijd || ''),
      instructies: logResult('instructies', datum ? '' : 'DATUM ONTBREEKT'),
      laadreferentie: logResult('laadreferentie', referentie),
      containertype: logResult('containertype', containertype),
      inleverBootnaam: '',
      inleverRederij: '',
      inleverBestemming: dropoffTerminal,
      pickupTerminal,
      dropoffTerminal,
      imo: '',
      unnr: '',
      brix: '',
      klantnaam: klantlocatie,
      klantadres: '',
      klantpostcode: '',
      klantplaats: '',
      adr: 'Onwaar',
      ladenOfLossen: 'Lossen',
      locaties: [
        {
          volgorde: '0',
          actie: 'Opzetten',
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
          naam: klantlocatie,
          adres: '',
          postcode: '',
          plaats: '',
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
    };

    containers.push(container);
  }

  return {
    ritnummer,
    containers
  };
}