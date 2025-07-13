// parsers/parseJordex.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getRederijNaam,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}

function formatDatum(text) {
  const match = text.match(/Date[:\t ]+(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!match) return '';
  const [_, day, monthStr, year] = match;
  const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  const maand = months[monthStr.toLowerCase().slice(0, 3)];
  return `${parseInt(day)}-${maand}-${year}`;
}

export default async function parseDFDS(pdfBuffer, klantAlias = 'dfds') {
  console.log('📦 Ontvangen pdfBuffer:', pdfBuffer?.length, 'bytes');
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('❌ Ongeldige of ontbrekende PDF buffer');
    return {};
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }

  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Multi-pattern extractor
  const multiExtract = (patterns) => {
    for (const pattern of patterns) {
      const found = regels.find(line => pattern.test(line));
      if (found) {
        const match = found.match(pattern);
        if (match?.[1]) {
          const result = match[1].trim();
          console.log(`🔎 Pattern match: ${pattern} ➜ ${result}`);
          return result;
        }
      }
    }
    return '';
  };

  // 📦 Containerregels extraheren
  const containerRegels = regels.filter(r =>
    /[A-Z]{4}U\d{7}/.test(r) || /Zegel[:\s]/i.test(r) || /kg/i.test(r) || /m3/i.test(r)
  );
  console.log('📦 Geselecteerde containerregels:', containerRegels);

  // Init vars
  let containernummer = '', containertype = '', zegelnummer = '', gewicht = '', volume = '', colli = '', referentie = '', lading = '';

  // Zoek in containerRegels
  for (const regel of containerRegels) {
    // Containernummer
    if (!containernummer) {
      const match = regel.match(/([A-Z]{4}U\d{7})/);
      if (match) {
        containernummer = match[1];
        console.log('🚛 Containernummer gevonden:', containernummer);
      }
    }
    // Containertype
    if (!containertype) {
      // Zoek bv. "CAIU7388667 40ft HC - 76.3 m3"
      const match = regel.match(/[A-Z]{4}U\d{7}\s+([^\s-]+(?:\s+[A-Z]+)?)\s*[-–]\s*[\d.,]+\s*m3/i);
      if (match) {
        containertype = match[1].trim();
        console.log('📦 Containertype gevonden:', containertype);
      }
    }
    // Zegelnummer
    if (!zegelnummer && regel.toLowerCase().includes('zegel')) {
      const match = regel.match(/Zegel[:\s]+(\w+)/i);
      if (match) {
        zegelnummer = match[1];
        console.log('🔐 Zegelnummer gevonden:', zegelnummer);
      }
    }
    // Gewicht
    if (regel.toLowerCase().includes('kg') && !gewicht) {
      const match = regel.match(/([\d.,]+)\s*kg/i);
      if (match) {
        gewicht = match[1].replace(',', '.');
        if (gewicht.includes('.')) gewicht = Math.round(parseFloat(gewicht)).toString();
        console.log('⚖️ Gewicht gevonden:', gewicht);
      }
    }
    // Volume
    if (regel.toLowerCase().includes('m3') && !volume) {
      const match = regel.match(/([\d.,]+)\s*m3/i);
      if (match) {
        volume = match[1].replace(',', '.');
        console.log('📏 Volume gevonden:', volume);
      }
    }
    // Colli
    if (!colli && regel.match(/^\d{2,5}$/)) {
      colli = regel.trim();
      console.log('📦 Colli gevonden:', colli);
    }
    // Referentie
    if (!referentie) {
      const refMatch = regel.match(/Lossen.*?(\d{7,})/i);
      if (refMatch) {
        referentie = refMatch[1];
        console.log('📌 Referentie gevonden:', referentie);
      }
    }
    // Lading
    if (!lading) {
      const ladingMatch = regel.match(/^\d+\s+\w+\s+(.*?)\s+[\d.,]+\s*kg/i);
      if (ladingMatch) {
        lading = ladingMatch[1].trim();
        console.log('📦 Lading gevonden:', lading);
      }
    }
  }

  // Klantgegevens zoeken (tolerant)
  let klantnaam = '', klantadres = '', klantpostcode = '', klantplaats = '';
  for (let i = 0; i < regels.length; i++) {
    if (!klantnaam && /bv|b\.v\.|gmbh|nv|llc|ltd|company|co\.|b v|b v\.|b\. v\./i.test(regels[i])) {
      klantnaam = regels[i];
    }
    if (!klantadres && /\d{1,4}\s+\w+/.test(regels[i])) {
      klantadres = regels[i];
    }
    if (!klantpostcode && /\d{4}\s?[A-Z]{2}/.test(regels[i])) {
      const m = regels[i].match(/(\d{4}\s?[A-Z]{2})/);
      if (m) klantpostcode = m[1];
      klantplaats = regels[i].replace(klantpostcode, '').trim();
    }
  }

  // Datum & tijd
  let laadDatum = '', laadTijd = '', bijzonderheid = '';
  const dateLine = regels.find(r => /^Date[:\t ]+/i.test(r)) || '';
  const dateMatch = dateLine.match(/Date:\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
  if (dateMatch) {
    const dag = parseInt(dateMatch[1]);
    const maandStr = dateMatch[2].toLowerCase().slice(0, 3);
    const jaar = dateMatch[3];
    const tijd = dateMatch[4];
    const maanden = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    const maand = maanden[maandStr];
    laadDatum = `${dag}-${maand}-${jaar}`;
    laadTijd = tijd ? `${tijd}:00` : '';
  } else {
    const nu = new Date();
    laadDatum = `${nu.getDate()}-${nu.getMonth() + 1}-${nu.getFullYear()}`;
    laadTijd = '';
    bijzonderheid = 'DATUM STAAT VERKEERD';
  }

  // Terminals
  const pickupTerminalMatch = text.match(/Pick[-\s]?up terminal[\s\S]+?Address:\s*(.+)/i);
  const puKey = pickupTerminalMatch?.[1]?.trim() || '';
  const dropoffTerminalMatch = text.match(/Drop[-\s]?off terminal[\s\S]+?Address:\s*(.+)/i);
  const doKey = dropoffTerminalMatch?.[1]?.trim() || '';

  // Terminal lookups
  const pickupInfo = await getTerminalInfoMetFallback(puKey);
  const dropoffInfo = await getTerminalInfoMetFallback(doKey);

  // Rederij & bootnaam
  const rederij = multiExtract([/Carrier[:\t ]+(.+)/i]) || '';
  const bootnaam = multiExtract([/Vessel[:\t ]+(.+)/i]) || '';

  // Data object
  const data = {
    ritnummer: logResult('ritnummer', referentie || '0'),
    referentie: logResult('referentie', referentie || ''),
    colli: logResult('colli', colli || '0'),
    volume: logResult('volume', volume || '0'),
    gewicht: logResult('gewicht', gewicht || '0'),
    lading: logResult('lading', lading || ''),
    containernummer: logResult('containernummer', containernummer || ''),
    containertype: logResult('containertype', containertype || ''),
    zegelnummer: logResult('zegelnummer', zegelnummer || ''),
    inleverreferentie: logResult('inleverreferentie', ''),
    rederij: logResult('rederij', rederij),
    bootnaam: logResult('bootnaam', bootnaam),
    temperatuur: logResult('temperatuur', multiExtract([/Temperature[:\t ]+([\-\d]+°C)/i]) || '0'),
    datum: logResult('datum', laadDatum),
    tijd: logResult('tijd', laadTijd),
    instructies: logResult('instructies', bijzonderheid),
    laadreferentie: logResult('laadreferentie', ''),
    inleverBootnaam: logResult('inleverBootnaam', bootnaam),
    inleverRederij: logResult('inleverRederij', rederij),
    inleverBestemming: logResult('inleverBestemming', ''),
    pickupTerminal: logResult('pickupTerminal', puKey),
    dropoffTerminal: logResult('dropoffTerminal', doKey),
    imo: logResult('imo', multiExtract([/IMO[:\t ]+(\d+)/i]) || '0'),
    unnr: logResult('unnr', multiExtract([/UN[:\t ]+(\d+)/i]) || '0'),
    brix: logResult('brix', multiExtract([/Brix[:\t ]+(\d+)/i]) || '0'),
    opdrachtgeverNaam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
    opdrachtgeverAdres: 'WOLGAWEG 3',
    opdrachtgeverPostcode: '3200AA',
    opdrachtgeverPlaats: 'SPIJKENISSE',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781',
    terminal: '0',
    rederijCode: '0',
    containertypeCode: '0',
    klantnaam,
    klantadres,
    klantpostcode,
    klantplaats
  };

  // Locatiestructuur
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
      naam: klantnaam || '',
      adres: klantadres || '',
      postcode: klantpostcode || '',
      plaats: klantplaats || '',
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

  // Bepaal laden/lossen
  data.isLossenOpdracht = !!data.containernummer && data.containernummer !== '0';
  data.ladenOfLossen = data.isLossenOpdracht ? 'Lossen' : 'Laden';

  // ADR
  if (data.imo !== '0' || data.unnr !== '0') {
    data.adr = 'Waar';
  } else {
    data.adr = 'Onwaar';
    delete data.imo;
    delete data.unnr;
    delete data.brix;
  }

  // Debug logs
  console.log('📍 Volledige locatiestructuur gegenereerd:', data.locaties);
  console.log('✅ Eindwaarde opdrachtgever:', data.opdrachtgeverNaam);
  console.log('📤 DATA OBJECT UIT PARSEDFDS:', JSON.stringify(data, null, 2));
  return data;
}
