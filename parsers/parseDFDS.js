import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getRederijNaam,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';
import { logResult, printLogs } from '../utils/log.js';

export default async function parseDFDS(pdfBuffer) {
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);


  const containers = [];

  const ritnummer = logResult('ritnummer', text.match(/\bSFIM\d{7}\b/i)?.[0] || '');
  const bootnaam = logResult('bootnaam', text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1] || '');
  const rederijRaw = text.match(/Rederij[:\t ]+(.+)/i)?.[1]?.trim() || '';
  const rederij = logResult('rederij', await getRederijNaam(rederijRaw) || rederijRaw);

  const laadreferentie = logResult('laadreferentie', text.match(/Lossen[\s\S]+?(I\d{8})/)?.[1] || '');
  const inleverreferentie = logResult('inleverreferentie', text.match(/Drop[-\s]?off[\s\S]+?Reference[:\t ]+([A-Z0-9\-]+)/i)?.[1] || '');

  const klantMatch = text.match(/Lossen\s*\n([\s\S]+?)(?=\n(?:Drop|Pickup|Extra|$))/i)?.[1] || '';
  const klantRegels = klantMatch.split('\n').map(r => r.trim()).filter(Boolean);
  const klantnaam = logResult('klantnaam', klantRegels[0] || '');
  const klantadres = logResult('klantadres', klantRegels[1] || '');
  const klantpostcode = logResult('klantpostcode', klantadres.match(/\d{4}\s?[A-Z]{2}/)?.[0] || '');
  const klantplaats = logResult('klantplaats', klantadres.replace(klantpostcode, '').replace(',', '').trim());

  const tijdMatch = text.match(/(\d{2}):(\d{2})/);
  const tijd = logResult('tijd', tijdMatch ? `${tijdMatch[1]}:${tijdMatch[2]}:00` : '');

  const dateMatch = text.match(/Pickup[\s\S]+?(\d{2})-(\d{2})-(\d{4})/);
  const datum = logResult('datum', dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : new Date().toLocaleDateString('nl-NL'));

  const adr = regels.some(r => /ADR|UN\d{4}|IMO|Lithium|Hazardous/i.test(r)) ? 'Waar' : 'Onwaar';
  logResult('adr', adr);

  const pickupTerminal = text.match(/Pick[-\s]?up terminal[\s\S]+?Address:\s*(.+)/i)?.[1]?.trim() || '';
  const dropoffTerminal = text.match(/Drop[-\s]?off terminal[\s\S]+?Address:\s*(.+)/i)?.[1]?.trim() || '';
  const pickupInfo = await getTerminalInfoMetFallback(pickupTerminal);
  const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal);


  console.log(`📦 Aantal containers gevonden: ${containerRegels.length}`);
if (containerRegels.length === 0) {
  logResult('FOUT', 'Geen containers gevonden');
  printLogs('geen containers');
  return [];
}
  const containerRegels = regels.filter(r => r.match(/\b([A-Z]{4}\d{7})\b\s+(.+?)\s+-\s+([\d.]+)\s*m3/i));

for (const regel of containerRegels) {
  const match = regel.match(/\b([A-Z]{4}\d{7})\b\s+(.+?)\s+-\s+([\d.]+)\s*m3/i);
  if (!match) continue;

  const containernummer = logResult('containernummer', match[1]);
  const containertypeRaw = logResult('containertype', match[2]);
  const volume = logResult('volume', match[3]);
  const containertypeCode = logResult('containertypeCode', await getContainerTypeCode(containertypeRaw));
  const zegel = logResult('zegel', (regels.find(r => r.includes(containernummer) && r.includes('Zegel'))?.match(/Zegel:\s*([A-Z0-9]+)/i)?.[1]) || '');

  const gewicht = logResult('gewicht', (regels.find(r => r.includes('kg'))?.match(/([\d.,]+)\s*kg/i)?.[1] || '0').replace(',', '.'));
  const colli = logResult('colli', regels.find(r => /^\d{2,5}$/.test(r)) || '0');
  const lading = logResult('lading', regels.find(r => /\d+\s*CARTON|BAG|PALLET|BARREL/i.test(r)) || '');

  const data = {
  laadreferentie: logResult('laadreferentie', laadreferentie),
  inleverreferentie: logResult('inleverreferentie', inleverreferentie),

  // Container info
  containernummer: logResult('containernummer', containernummer),
  containertype: logResult('containertype', containertypeRaw),
  containertypeCode: logResult('containertypeCode', containertypeCode || ''),
  zegel: logResult('zegel', zegel),
  tarra: logResult('tarra', tarra),
  brutogewicht: logResult('brutogewicht', gewicht),
  geladenGewicht: logResult('geladenGewicht', geladenGewicht),
  cbm: logResult('cbm', volume),
  brix: logResult('brix', brix),
  colli: logResult('colli', colli),
  volume: logResult('volume', volume),
  gewicht: logResult('gewicht', gewicht),
  lading: logResult('lading', lading),
  adr: logResult('adr', adr),
  temperatuur: logResult('temperatuur', temperatuur),
  documentatie: logResult('documentatie', documentatie),
  tar: logResult('tar', tar),
  type: logResult('type', type),

  // Laad- en losinformatie
  datum: logResult('datum', laadDatum),
  tijd: logResult('tijd', tijd),
  instructies: logResult('instructies', instructies),

  // Boot/rederij
  bootnaam: logResult('bootnaam', bootnaam),
  rederij: logResult('rederij', rederij),
  inleverBootnaam: logResult('inleverBootnaam', inleverBootnaam),
  inleverRederij: logResult('inleverRederij', inleverRederij),
  loshaven: logResult('loshaven', loshaven),
  from: logResult('from', fromLocatie),
  to: logResult('to', toLocatie),

  // Opdrachtgever (underscore + camelCase)
  opdrachtgever_naam: logResult('opdrachtgever_naam', opdrachtgeverNaam),
  opdrachtgever_adres: logResult('opdrachtgever_adres', opdrachtgeverAdres),
  opdrachtgever_postcode: logResult('opdrachtgever_postcode', opdrachtgeverPostcode),
  opdrachtgever_plaats: logResult('opdrachtgever_plaats', opdrachtgeverPlaats),
  opdrachtgever_telefoon: logResult('opdrachtgever_telefoon', opdrachtgeverTelefoon),
  opdrachtgever_email: logResult('opdrachtgever_email', opdrachtgeverEmail),
  opdrachtgever_btw: logResult('opdrachtgever_btw', opdrachtgeverBTW),
  opdrachtgever_kvk: logResult('opdrachtgever_kvk', opdrachtgeverKVK),
  opdrachtgeverNaam: logResult('opdrachtgeverNaam', opdrachtgeverNaam),
  opdrachtgeverAdres: logResult('opdrachtgeverAdres', opdrachtgeverAdres),
  opdrachtgeverPostcode: logResult('opdrachtgeverPostcode', opdrachtgeverPostcode),
  opdrachtgeverPlaats: logResult('opdrachtgeverPlaats', opdrachtgeverPlaats),
  opdrachtgeverTelefoon: logResult('opdrachtgeverTelefoon', opdrachtgeverTelefoon),
  opdrachtgeverEmail: logResult('opdrachtgeverEmail', opdrachtgeverEmail),
  opdrachtgeverBTW: logResult('opdrachtgeverBTW', opdrachtgeverBTW),
  opdrachtgeverKVK: logResult('opdrachtgeverKVK', opdrachtgeverKVK),

  // Klant
  klantnaam: logResult('klantnaam', klantnaam),
  klantadres: logResult('klantadres', klantadres),
  klantpostcode: logResult('klantpostcode', klantpostcode),
  klantplaats: logResult('klantplaats', klantplaats),

  // Locaties (pickup, laden/lossen, dropoff)
  locaties: [
    {
      volgorde: '0',
      actie: 'Opzetten',
      naam: pickupInfo.naam || puKey,
      adres: pickupInfo.adres || '',
      postcode: pickupInfo.postcode || '',
      plaats: pickupInfo.plaats || '',
      land: pickupInfo.land || 'NL',
      voorgemeld: pickupInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
      aankomst_verw: pickupInfo.aankomst_verw || '',
      tijslot_van: pickupInfo.tijslot_van || '',
      tijslot_tm: pickupInfo.tijslot_tm || '',
      portbase_code: pickupInfo.portbase_code || '',
      bicsCode: pickupInfo.bicsCode || ''
    },
    {
      volgorde: '0',
      actie: isLossenOpdracht ? 'Lossen' : 'Laden',
      naam: klantnaam,
      adres: klantadres,
      postcode: klantpostcode,
      plaats: klantplaats,
      land: 'NL'
    },
    {
      volgorde: '0',
      actie: 'Afzetten',
      naam: dropoffInfo.naam || doKey,
      adres: dropoffInfo.adres || '',
      postcode: dropoffInfo.postcode || '',
      plaats: dropoffInfo.plaats || '',
      land: dropoffInfo.land || 'NL',
      voorgemeld: dropoffInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
      aankomst_verw: dropoffInfo.aankomst_verw || '',
      tijslot_van: dropoffInfo.tijslot_van || '',
      tijslot_tm: dropoffInfo.tijslot_tm || '',
      portbase_code: dropoffInfo.portbase_code || '',
      bicsCode: dropoffInfo.bicsCode || ''
      }
    ]
  };

  printLogs(data.containernummer || 'onbekend');
  containers.push(data);
}

  return containers;
}