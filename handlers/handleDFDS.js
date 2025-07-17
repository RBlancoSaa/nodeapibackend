// 📁 parsers/handleDFDS.js
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
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) return {};
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

  const ritnummer = text.match(/\bSFIM\d{7}\b/i)?.[0] || '0';
  const bootnaam = text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1] || '';
  const eta = text.match(/ETA\s+(\d{2})-(\d{2})-(\d{4})/i);
  const datum = eta ? `${parseInt(eta[1])}-${parseInt(eta[2])}-${eta[3]}` : '';
  const rederij = text.match(/Rederij\s+(.+)/i)?.[1] || '';
  const referentie = text.match(/Lossen\s+(\d{8})/i)?.[1] || '';

  const pickupTerminal = regels.find(r => r.toLowerCase().startsWith('pickup ect')) || '';
  const dropoffTerminal = regels.find(r => r.toLowerCase().startsWith('dropoff medrepair')) || '';
  const lossTerminal = regels.find(r => r.toLowerCase().startsWith('lossen c. steinweg')) || '';

  const containers = [];
  const containerLines = regels.filter(r => /^[A-Z]{4}U?\d{7}/.test(r));
  const omschrijvingen = regels.filter(r => /^\d+\s+BAG/.test(r));

  for (let i = 0; i < containerLines.length; i++) {
    const lijn = containerLines[i];
    const match = lijn.match(/^([A-Z]{4}U?\d{7})\s+(\d{2}ft.*?)\s+\/\s+Zegel:\s+(\d+)/i);
    if (!match) continue;

    const [_, containerNummer, type, zegel] = match;
    const gewichtMatch = omschrijvingen[i]?.match(/([\d.,]+)\s*kg/i);
    const gewicht = gewichtMatch ? gewichtMatch[1].replace(',', '.') : '0';

    const containerTypeCode = await getContainerTypeCode(type);
    const pickupInfo = await getTerminalInfoMetFallback(pickupTerminal);
    const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal);

    containers.push({
      ritnummer,
      referentie,
      datum,
      tijd: '',
      containernummer: containerNummer,
      containertype: containerTypeCode || '', 
      containertypeRaw: type,                   
      zegelnummer: zegel,
      lading: '',
      gewicht,
      volume: '',
      adr: '',
      bootnaam,
      rederij,
      inleverBootnaam: bootnaam,
      inleverRederij: rederij,
      inleverreferentie: referentie,
      inleverBestemming: dropoffTerminal,

      laadreferentie: referentie,
      meldtijd: '',
      temperatuur: '',
      tijdvenster: '',

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
          portbase_code: dropoffInfo.portbase_code || '',
          bicsCode: dropoffInfo.bicsCode || ''
        }
      ]
    });
  }

  const officiëleRederij = await getRederijNaam(rederij);
  const rederijNaam = officiëleRederij && officiëleRederij !== '0' ? officiëleRederij : rederij;

  return {
    ritnummer: logResult('ritnummer', ritnummer),
    containers,
    bootnaam: logResult('bootnaam', bootnaam),
    rederij: logResult('rederij', rederijNaam)
  };
}