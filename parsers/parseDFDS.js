// parsers/parseJordex.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
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
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }

  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Helper: zoek eerste match in alle regels
  function findFirst(pattern) {
    for (const r of regels) {
      const m = r.match(pattern);
      if (m) return m[1].trim();
    }
    return '';
  }

  // Ritnummer (Onze referentie: SFIMxxxxxxx) met fallback
  let referentie = findFirst(/Lossen.*?(\d{7,})/i);
  if (!referentie) {
    referentie = findFirst(/(?:Order|Booking|Reference|Transport Document No\.?).*?([A-Z0-9\-\/]+)/i);
  }
  const fallbackRitnummer = referentie?.match(/SFIM\d{7}/i)?.[0];
  const ritnummer = findFirst(/Onze referentie[:\t ]+(SFIM\d{7})/i) || fallbackRitnummer || '0';

  // Containernummer
  const containernummer = findFirst(/([A-Z]{4}\d{7})/);

  // Containertype (origineel én genormaliseerd)
  let containertype = '';
  for (const r of regels) {
    const m = r.match(/[A-Z]{4}\d{7}\s+([A-Z0-9]{4,6}|[0-9]{2,3}(?:ft)?\s?[A-Z]{2,3})/i);
    if (m) {
      containertype = m[1].replace(/\s+/g, '').toUpperCase();
      break;
    }
    const t = r.match(/\b(20GP|40GP|40HC|45HC|45R1|20DC|40DC|20RF|40RF|45RF|20OT|40OT|20FR|40FR)\b/i);
    if (t) {
      containertype = t[1].toUpperCase();
      break;
    }
  }
  console.log('🔍 Gevonden containertype:', containertype);
  const normalizedContainertype = (containertype || '').toLowerCase().replace(/[^a-z0-9]/gi, '');
  console.log('🔍 Normalized containertype:', normalizedContainertype);

  // ContainertypeCode lookup vóór data object
  let typeCode = '0';
  try {
    typeCode = await getContainerTypeCode(normalizedContainertype);
    console.log('📦 Gezochte containertypeCode via getContainerTypeCode():', typeCode);
  } catch (e) {
    console.warn('⚠️ Fout bij ophalen containertypeCode:', e);
  }

  // Zegelnummer
  const zegelnummer = findFirst(/Zegel[:\s]+([A-Z0-9]+)/i);

  // Gewicht (zoek grootste getal met "kg" erachter)
  let gewicht = '';
  for (const r of regels) {
    const m = r.match(/([\d.,]+)\s*kg/i);
    if (m) {
      const val = m[1].replace(',', '.');
      if (!gewicht || parseFloat(val) > parseFloat(gewicht)) gewicht = val;
    }
  }

  // Volume (zoek grootste getal met "m3" erachter)
  let volume = '';
  for (const r of regels) {
    const m = r.match(/([\d.,]+)\s*m3/i);
    if (m) {
      const val = m[1].replace(',', '.');
      if (!volume || parseFloat(val) > parseFloat(volume)) volume = val;
    }
  }

  // Colli (zoek getal gevolgd door "colli" of "carton" of "pcs")
  let colli = findFirst(/(\d+)\s*(colli|carton|pcs)/i);
  if (!colli) {
    for (const r of regels) {
      if (/carton|pcs/i.test(r)) {
        const m = r.match(/(\d+)/);
        if (m) { colli = m[1]; break; }
      }
    }
  }

  // Lading (zoek eerste regel met veel hoofdletters/woorden na containernummer)
  let lading = '';
  for (const r of regels) {
    if (containernummer && r.includes(containernummer)) {
      const m = r.match(/[A-Z]{4}\d{7}\s+[A-Z0-9]{4,6}\s+(.+?)\s+[\d.,]+\s*kg/i);
      if (m) { lading = m[1].trim(); break; }
    }
  }
  if (!lading) {
    for (const r of regels) {
      const m = r.match(/(.+?)\s+[\d.,]+\s*kg/i);
      if (m && m[1].length > 3) { lading = m[1].trim(); break; }
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

  // Terminals (fallbacks toegevoegd)
  let pickupTerminal = findFirst(/Pick[-\s]?up terminal[\s\S]+?Address:\s*(.+)/i)
    || findFirst(/pickup[:\s]+(.+)/i)
    || '';
  let dropoffTerminal = findFirst(/Drop[-\s]?off terminal[\s\S]+?Address:\s*(.+)/i)
    || findFirst(/dropoff[:\s]+(.+)/i)
    || '';

  // Terminal lookups
  const pickupInfo = await getTerminalInfoMetFallback(pickupTerminal);
  const dropoffInfo = await getTerminalInfoMetFallback(dropoffTerminal);

  // Rederij & bootnaam
  const rederij = findFirst(/Carrier[:\t ]+(.+)/i) || '';
  const bootnaam = findFirst(/Vessel[:\t ]+(.+)/i) || '';

  // Datum & tijd (met padding en seconds)
  const pad = n => n.toString().padStart(2, '0');
  let laadDatum = '', laadTijd = '', bijzonderheid = '';
  let dateLine = regels.find(r => /^Date[:\t ]+/i.test(r)) || '';
  let dateMatch = dateLine.match(/Date:\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
  if (!dateMatch) {
    dateLine = regels.find(r => /^Datum[:\t ]+/i.test(r)) || '';
    dateMatch = dateLine.match(/Datum:\s*(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
    if (dateMatch) {
      laadDatum = `${pad(dateMatch[1])}-${pad(dateMatch[2])}-${dateMatch[3]}`;
      laadTijd = dateMatch[4] ? `${dateMatch[4]}:00` : '';
    }
  }
  if (dateMatch) {
    if (!laadDatum) {
      const dag = pad(parseInt(dateMatch[1]));
      const maandStr = dateMatch[2].toLowerCase().slice(0, 3);
      const jaar = dateMatch[3];
      const tijd = dateMatch[4];
      const maanden = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
      const maand = pad(maanden[maandStr] || maandStr);
      laadDatum = `${dag}-${maand}-${jaar}`;
      laadTijd = tijd ? `${tijd}:00` : '';
    }
  } else {
    const nu = new Date();
    laadDatum = `${pad(nu.getDate())}-${pad(nu.getMonth() + 1)}-${nu.getFullYear()}`;
    laadTijd = '';
    bijzonderheid = 'DATUM STAAT VERKEERD';
  }
  if (laadTijd && !/:00$/.test(laadTijd)) laadTijd += ':00';

  // Data object
  const data = {
    ritnummer: logResult('ritnummer', ritnummer || '0'),
    referentie: logResult('referentie', referentie || ''),
    colli: logResult('colli', colli || '0'),
    volume: logResult('volume', volume || '0'),
    gewicht: logResult('gewicht', gewicht || '0'),
    lading: logResult('lading', lading || ''),
    containernummer: logResult('containernummer', containernummer || ''),
    containertype: logResult('containertype', containertype || ''),
    containertypeCode: logResult('containertypeCode', typeCode || '0'),
    zegelnummer: logResult('zegelnummer', zegelnummer || ''),
    inleverreferentie: logResult('inleverreferentie', ''),
    rederij: logResult('rederij', rederij),
    bootnaam: logResult('bootnaam', bootnaam),
    temperatuur: logResult('temperatuur', findFirst(/Temperature[:\t ]+([\-\d]+°C)/i) || '0'),
    datum: logResult('datum', laadDatum),
    tijd: logResult('tijd', laadTijd),
    instructies: logResult('instructies', bijzonderheid),
    laadreferentie: logResult('laadreferentie', ''),
    inleverBootnaam: logResult('inleverBootnaam', bootnaam),
    inleverRederij: logResult('inleverRederij', rederij),
    inleverBestemming: logResult('inleverBestemming', ''),
    pickupTerminal: logResult('pickupTerminal', pickupTerminal),
    dropoffTerminal: logResult('dropoffTerminal', dropoffTerminal),
    opdrachtgeverNaam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
    opdrachtgeverAdres: 'WOLGAWEG 3',
    opdrachtgeverPostcode: '3200AA',
    opdrachtgeverPlaats: 'SPIJKENISSE',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781',
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
      naam: klantnaam || '',
      adres: klantadres || '',
      postcode: klantpostcode || '',
      plaats: klantplaats || '',
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
  ];

  // Bepaal laden/lossen
  data.isLossenOpdracht = !!data.containernummer && data.containernummer !== '0';
  data.ladenOfLossen = data.isLossenOpdracht ? 'Lossen' : 'Laden';

  // ADR
  data.adr = (findFirst(/IMO[:\t ]+(\d+)/i) || findFirst(/UN[:\t ]+(\d+)/i)) ? 'Waar' : 'Onwaar';

  // Fallback check
  if (!containertype || !data.containertypeCode || data.containertypeCode === '0') {
    console.warn('🚫 Containertype ontbreekt of wordt niet herkend');
  }

  // Debug logs
  console.log('📍 Volledige locatiestructuur gegenereerd:', data.locaties);
  console.log('✅ Eindwaarde opdrachtgever:', data.opdrachtgeverNaam);
  console.log('📤 DATA OBJECT UIT PARSEDFDS:', JSON.stringify(data, null, 2));
  return data;
}
