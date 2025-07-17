// handlers/handleDFDS.js
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

export default async function handleDFDS(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) return [];

  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

  // Opdrachtgever hardcoded
  const opdrachtgever = {
    opdrachtgeverNaam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
    opdrachtgeverAdres: 'WOLGAWEG 3',
    opdrachtgeverPostcode: '3198 LR',
    opdrachtgeverPlaats: 'ROTTERDAM',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781'
  };

  // Ritnummer, bootnaam, rederij, referentie
  const ritnummer = text.match(/\bSFIM\d{7}\b/i)?.[0] || '0';
  const bootnaam = text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1] || '';
  const eta = text.match(/ETA\s+(\d{2})-(\d{2})-(\d{4})/i);
  const datum = eta ? `${parseInt(eta[1])}-${parseInt(eta[2])}-${eta[3]}` : '';
  const rederijRaw = text.match(/Rederij\s+(.+)/i)?.[1] || '';
  const referentie = text.match(/Lossen\s+(\d{8})/i)?.[1] || '0';

  // Terminal info
  const pickupTerminal = regels.find(r => r.toLowerCase().includes('pickup')) || '';
  const dropoffTerminal = regels.find(r => r.toLowerCase().includes('dropoff')) || '';
  const lossTerminal = regels.find(r => r.toLowerCase().includes('lossen')) || '';

  // Containers
  const containerLines = regels.filter(r => /^[A-Z]{4}U?\d{7}/.test(r));
  const omschrijvingen = regels.filter(r => /^\d+\s+BAG/.test(r));

  const containers = [];
  for (let i = 0; i < containerLines.length; i++) {
    const lijn = containerLines[i];
    const match = lijn.match(/^([A-Z]{4}U?\d{7})\s+(\d{2,3}ft.*?)\s+\/\s+Zegel:\s+(\d+)/i);
    if (!match) continue;

    const [_, containernummer, containertypeOmschrijving, zegel] = match;
    const gewichtMatch = omschrijvingen[i]?.match(/([\d.,]+)\s*kg/i);
    const brutogewicht = gewichtMatch ? gewichtMatch[1].replace(',', '.') : '0';

    // ContainerTypeCode lookup
    const containertype = await getContainerTypeCode(containertypeOmschrijving);

    // Terminal info
    const pickupInfo = await getTerminalInfoMetFallback(pickupTerminal);
    const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal);

    // Rederij normaliseren
    const baseRederij = rederijRaw.includes(' - ')
      ? rederijRaw.split(' - ')[1].trim()
      : rederijRaw.trim();
    const officiëleRederij = await getRederijNaam(baseRederij);
    const rederij = officiëleRederij && officiëleRederij !== '0' ? officiëleRederij : baseRederij;

    // Data object per container
    const data = {
      ...opdrachtgever,
      ritnummer: ritnummer,
      referentie: referentie,
      colli: '',
      volume: '',
      gewicht: brutogewicht,
      lading: '', // Vul uit PDF als mogelijk
      containernummer: containernummer,
      containertype: containertype || '',
      containertypeOmschrijving: containertypeOmschrijving,
      zegel: zegel,
      temperatuur: '', // Vul uit PDF als mogelijk
      datum: datum || (() => {
        const nu = new Date();
        return `${nu.getDate()}-${nu.getMonth() + 1}-${nu.getFullYear()}`;
      })(),
      tijd: '', // Vul uit PDF als mogelijk
      instructies: '',
      laadreferentie: referentie,
      inleverreferentie: referentie,
      bootnaam: bootnaam,
      rederij: rederij,
      inleverBootnaam: bootnaam,
      inleverRederij: rederij,
      inleverBestemming: dropoffTerminal,
      tarra: '',
      brutogewicht: brutogewicht,
      geladenGewicht: brutogewicht,
      cbm: '',
      brix: '',
      adr: '',
      documentatie: '',
      tar: '',
      type: '',
      klantnaam: '',
      klantadres: '',
      klantpostcode: '',
      klantplaats: '',
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
          naam: '',
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

    containers.push(data);
  }

  // Return array van data objects (voor generateXmlFromJson)
  return containers;
}