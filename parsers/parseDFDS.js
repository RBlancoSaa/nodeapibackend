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

export default async function parseDFDS(pdfBuffer, klantAlias = 'dfds') {
  console.log('📦 Ontvangen pdfBuffer:', pdfBuffer?.length, 'bytes');
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 100) return {};

  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(l => l.trim()).filter(Boolean);



  const multiExtract = (patterns) => {
    for (const pattern of patterns) {
      const found = regels.find(line => pattern.test(line));
      if (found) {
        const match = found.match(pattern);
        if (match?.[1]) return match[1].trim();
      }
    }
    return '';
  };

  // 📅 Datum & Tijd — (later specificeren, voorlopig fallback)
  const nu = new Date();
  const laadDatum = `${nu.getDate()}-${nu.getMonth() + 1}-${nu.getFullYear()}`;
  const laadTijd = '';
  const bijzonderheid = 'DATUM MOET NOG GEFINETUNED WORDEN';

  let ritnummer = '';
const ritnummerMatch = text.match(/Onze referentie\s+(SFIM\d{7})/i);
if (ritnummerMatch) ritnummer = ritnummerMatch[1];

if (!ritnummer && klantAlias?.match(/SFIM\d{7}/i)) {
  ritnummer = klantAlias.match(/SFIM\d{7}/i)[0];
  console.warn(`⚠️ Ritnummer uit tekst niet gevonden — fallback naar alias: ${ritnummer}`);
}

if (!ritnummer) {
  console.warn('❌ Geen ritnummer gevonden in tekst of fallback');
  ritnummer = '0';
}


  const data = {
    ritnummer: logResult('ritnummer', ritnummer),
    referentie: logResult('referentie', multiExtract([/Reference[:\t ]+([A-Z0-9\-]+)/i])),
    colli: logResult('colli', '0'),
    volume: logResult('volume', '0'),
    gewicht: logResult('gewicht', '0'),
    lading: logResult('lading', multiExtract([/Goods[:\t ]+(.+)/i]) || '0'),
    inleverreferentie: logResult('inleverreferentie', '0'),
    rederij: logResult('rederij', multiExtract([/Shipping Line[:\t ]+(.+)/i])),
    bootnaam: logResult('bootnaam', multiExtract([/Vessel[:\t ]+(.+)/i])),
    containernummer: logResult('containernummer', multiExtract([/Container[:\t ]+([A-Z]{4}U\d{7})/i])),
    temperatuur: logResult('temperatuur', multiExtract([/Temp(?:erature)?[:\t ]+([\-\d]+°C)/i]) || '0'),
    datum: logResult('datum', laadDatum),
    tijd: logResult('tijd', laadTijd),
    instructies: logResult('instructies', bijzonderheid),
    laadreferentie: logResult('laadreferentie', multiExtract([/Reference[:\t ]+([A-Z0-9\-]+)/i])),
    containertype: logResult('containertype', multiExtract([/Container Type[:\t ]+(.+)/i])),
    inleverBootnaam: '',
    inleverRederij: '',
    inleverBestemming: multiExtract([/Arrival[:\t ]+(.+)/i]),
    pickupTerminal: multiExtract([/Pick-up Terminal[:\t ]+(.+)/i]),
    dropoffTerminal: multiExtract([/Drop-off Terminal[:\t ]+(.+)/i]),
    imo: multiExtract([/IMO[:\t ]+(\d+)/i]) || '0',
    unnr: multiExtract([/UN[:\t ]+(\d+)/i]) || '0',
    brix: multiExtract([/Brix[:\t ]+(\d+)/i]) || '0',

    opdrachtgeverNaam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
    opdrachtgeverAdres: 'WOLGAWEG 3',
    opdrachtgeverPostcode: '3200AA',
    opdrachtgeverPlaats: 'SPIJKENISSE',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'TRANSPORT@DFDS.COM',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781',

    terminal: '0',
    rederijCode: '0',
    containertypeCode: '0'
  };

  const puKey = data.pickupTerminal;
  const doKey = data.dropoffTerminal;
  const pickupInfo = await getTerminalInfoMetFallback(puKey);
  const dropoffInfo = await getTerminalInfoMetFallback(doKey);

  data.klantnaam = 'DFDS CLIENT';
  data.klantadres = 'ONBEKEND';
  data.klantpostcode = '';
  data.klantplaats = 'Rotterdam';

  const from = multiExtract([/From[:\t ]+(.+)/i]) || '';
  const to = multiExtract([/To[:\t ]+(.+)/i]) || '';
  data.isLossenOpdracht = from.toLowerCase().includes('cn') || to.toLowerCase().includes('rotterdam');
  data.ladenOfLossen = data.isLossenOpdracht ? 'Lossen' : 'Laden';

  if (data.imo !== '0' || data.unnr !== '0') {
    data.adr = 'Waar';
  } else {
    data.adr = 'Onwaar';
    delete data.imo;
    delete data.unnr;
    delete data.brix;
  }

  try {
    data.terminal = await getTerminalInfo(data.dropoffTerminal) || '0';
    data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';
    const baseRederij = data.rederij.includes(' - ') ? data.rederij.split(' - ')[1].trim() : data.rederij.trim();
    const officiëleRederij = await getRederijNaam(baseRederij);
    if (officiëleRederij && officiëleRederij !== '0') {
      data.rederij = officiëleRederij;
      data.inleverRederij = officiëleRederij;
    }
  } catch (e) {
    console.warn('⚠️ Fout in terminal of rederij lookup:', e);
  }

  data.locaties = [
    {
      volgorde: '0',
      actie: 'Opzetten',
      naam: pickupInfo.naam || puKey,
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
      actie: data.isLossenOpdracht ? 'Lossen' : 'Laden',
      naam: data.klantnaam || '',
      adres: data.klantadres || '',
      postcode: data.klantpostcode || '',
      plaats: data.klantplaats || '',
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
      aankomst_verw: '',
      tijslot_van: '',
      tijslot_tm: '',
      portbase_code: dropoffInfo.portbase_code || '',
      bicsCode: dropoffInfo.bicsCode || ''
    }
  ];

  return data;
}