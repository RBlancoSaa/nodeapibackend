// parsers/parseDFDS.js
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

export default async function parseDFDS(pdfBuffer, klantAlias = 'dfds') {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('❌ Ongeldige of ontbrekende PDF buffer');
    return {};
  }
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 🔢 Ritnummer = SFIMxxxxxxx
  const ritnummer = text.match(/\b(SFIM\d{7})\b/)?.[1] || '0';

  // 🚢 Boot & rederij
  const bootnaam = text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1]?.trim() || '';
  const rederij = text.match(/Rederij\s+(.+)/i)?.[1]?.trim() || '';

  // 📦 Containernummer, type en volume
  const containerLine = regels.find(l => /^[A-Z]{4}\d{7}\s/.test(l)) || '';
  const containernummer = containerLine.match(/^([A-Z]{4}\d{7})/)?.[1] || '';
  const containertype = containerLine.match(/^\S+\s+(.+?)\s+-/)?.[1]?.trim() || '';
  const volume = containerLine.match(/-\s*([\d.,]+)\s*m3/i)?.[1]?.replace(',', '.') || '0';

  const containertypeCode = await getContainerTypeCode(containertype);

  // 🔐 Zegelnummer
  const zegelregel = regels.find(r => /Zegel/i.test(r)) || '';
  const zegel = zegelregel.match(/Zegel[:\s]*([A-Z0-9]+)/i)?.[1] || '';

  // 🔁 Referentie & tijd
  const referentieLine = regels.find(r => /^\d{8}\s+\d{2}-\d{2}-\d{4}/.test(r)) || '';
  const referentie = referentieLine.split(' ')[0] || '';
  const datumMatch = referentieLine.match(/(\d{2})-(\d{2})-(\d{4})/);
  const tijdMatch = referentieLine.match(/(\d{2}:\d{2})/);

  const datum = datumMatch ? `${parseInt(datumMatch[1])}-${parseInt(datumMatch[2])}-${datumMatch[3]}` : '';
  const tijd = tijdMatch ? `${tijdMatch[1]}:00` : '';

  // 🗃️ Lading & gewicht
  const ladingRegel = regels.find(r => /\d+\,?\d*\s*kg/i.test(r)) || '';
  const gewicht = ladingRegel.match(/([\d.,]+)\s*kg/i)?.[1]?.replace(',', '.') || '0';
  const lading = ladingRegel.replace(/[\d.,]+\s*kg.*$/, '').trim();

  // 📍 Locaties
  const pickupLine = regels.find(r => /^Pickup\s+/i.test(r)) || '';
  const pickupTerminal = pickupLine.replace(/^Pickup\s+/, '').trim();

  const dropoffLine = regels.find(r => /^Dropoff\s+/i.test(r)) || '';
  const dropoffTerminal = dropoffLine.replace(/^Dropoff\s+/, '').trim();

  const dropoffRef = dropoffLine.match(/Reference[:\s]+([A-Z0-9\-]+)/i)?.[1] || '';

  // 🌡️ Temperatuur
  const temperatuur = text.match(/-?(\d{1,2})\s*°?C/)?.[1] || '0';

  // 📦 Klantgegevens
  const klantregel = regels.find(r => r.toLowerCase().includes('lossen') || r.toLowerCase().includes('dropoff')) || '';
  const klantMatch = klantregel.match(/Lossen\s+(.+)/i);
  const klantNaam = klantMatch?.[1] || '';
  const klantAdres = klantregel.match(/Adres[:\s]+(.+)/i)?.[1] || '';
  const klantPostcode = klantregel.match(/Postcode[:\s]+(.+)/i)?.[1] || '';
  const klantPlaats = klantregel.match(/Plaats[:\s]+(.+)/i)?.[1] || '';

  // 🧠 Terminalinfo ophalen
  const pickupInfo = await getTerminalInfoMetFallback(pickupTerminal);
  const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal);

  // 📤 Einddata
  const data = {
    ritnummer: logResult('ritnummer', ritnummer),
    containernummer: logResult('containernummer', containernummer),
    containertype: logResult('containertype', containertype),
    containertypeCode: logResult('containertypeCode', containertypeCode),
    volume: logResult('volume', volume),
    zegel: logResult('zegel', zegel),
    referentie: logResult('referentie', referentie),
    datum: logResult('datum', datum),
    tijd: logResult('tijd', tijd),
    gewicht: logResult('gewicht', gewicht),
    lading: logResult('lading', lading),
    temperatuur: logResult('temperatuur', temperatuur),
    laadreferentie: logResult('laadreferentie', referentie),
    inleverreferentie: logResult('inleverreferentie', dropoffRef),
    bootnaam: logResult('bootnaam', bootnaam),
    rederij: logResult('rederij', rederij),
    inleverBootnaam: logResult('inleverBootnaam', bootnaam),
    inleverRederij: logResult('inleverRederij', rederij),

    opdrachtgeverNaam: 'DFDS Warehousing Rotterdam BV',
    opdrachtgeverAdres: 'Wolgaweg 5',
    opdrachtgeverPostcode: '3198 LR',
    opdrachtgeverPlaats: 'ROTTERDAM',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781',

    klantnaam: klantNaam,
    klantadres: klantAdres,
    klantpostcode: klantPostcode,
    klantplaats: klantPlaats,

    adr: lading.toLowerCase().includes('adr') || lading.toLowerCase().includes('un') ? 'Waar' : 'Onwaar',
    colli: '',
    tarra: '',
    geladenGewicht: '',
    brutogewicht: '',
    brix: '',
    documentatie: '',
    instructies: datum ? '' : 'DATUM STAAT VERKEERD',
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
        actie: pickupTerminal.toLowerCase().includes('rotterdam') ? 'Laden' : 'Lossen',
        naam: klant.naam,
        adres: klant.adres,
        postcode: klant.postcode,
        plaats: klant.plaats,
        land: klant.land
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

  console.log('📤 PARSED DFDS DATA:', JSON.stringify(data, null, 2));
  return data;
}