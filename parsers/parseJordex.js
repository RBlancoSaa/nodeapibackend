// parsers/parseJordex.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfo,
  getRederijNaam,
  getContainerTypeCode,
  getKlantData,
  normalizeContainerOmschrijving,
} from '../utils/lookups/terminalLookup.js';

function formatDatum(ddmmyyyy) {
  if (!ddmmyyyy || typeof ddmmyyyy !== 'string') return '0';
  const months = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const parts = ddmmyyyy.trim().split(/[-/.\s]/);
  if (parts.length !== 3) return '0';
  let [dag, maand, jaar] = parts;
  maand = maand.length === 3 ? months[maand.toLowerCase()] : maand.padStart(2, '0');
  return `${dag.padStart(2, '0')}-${maand}-${jaar}`;
}

export default async function parseJordex(pdfBuffer, klantAlias = 'jordex') {
  console.log('📦 Ontvangen pdfBuffer:', pdfBuffer?.length, 'bytes');

  // ❌ Voorkom lege of ongeldige input
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('❌ Ongeldige of ontbrekende PDF buffer');
    return {};
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }

  // 📖 PDF uitlezen en opsplitsen
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // 🔍 Multi-pattern extractor: zoekt de eerste waarde die matcht op een van de patronen
  const multiExtract = (patterns) => {
    for (const pattern of patterns) {
      const found = lines.find(line => pattern.test(line));
      if (found) {
        const match = found.match(pattern);
        if (match?.[1]) {
          const result = match[1].trim();
          console.log(`🔎 Pattern match: ${pattern} ➜ ${result}`);
          return result;
        }
      }
    }
    return null;
  };

// Klantgegevens ophalen
  // 🧠 Klantgegevens ophalen uit Pick-up blok
  const klantblok = text.match(/Pick[-\s]?up:\s*([\s\S]+?)Drop[-\s]?off:/i);
  let regels = [], postcodeMatch = null;
  if (klantblok) {
    regels = klantblok[1].trim().split('\n').map(l => l.trim()).filter(Boolean);
    postcodeMatch = regels[2]?.match(/(\d{4}\s?[A-Z]{2})\s+(.+)/);
  }
  const ritnummerMatch = text.match(/\b(O[EI]\d{7})\b/i);
  const descBlockMatch = text.match(/Description\s*([\s\S]*?)Extra Information/i);
  let ladingFromBlock = descBlockMatch ? descBlockMatch[1].replace(/\s+/g, ' ').trim() : '0';



    // 🛠️ Hierna komt het vullen van het data-object met de extracted waarden uit de PDF
const data = {
    ritnummer: ritnummerMatch ? ritnummerMatch[1] : '0',
    referentie: (() => {
      const match = text.match(/Pick[-\s]?up terminal:[\s\S]+?Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
      return match?.[1]?.trim() || '0';
    })(),
    laadreferentie: (() => {
  const klantBlock = text.match(/Pick[-\s]?up:[\s\S]+?Drop[-\s]?off:/i);
  if (klantBlock) {
    const match = klantBlock[0].match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || '0';
  }
  return '0';
})(),
    inleverreferentie: (() => {
      const match = text.match(/Drop[-\s]?off terminal:[\s\S]+?Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
      return match?.[1]?.trim() || '0';
    })(),
    rederij: multiExtract([/Carrier[:\t ]+(.+)/i]) || '0',
    bootnaam: multiExtract([/Vessel[:\t ]+(.+)/i]) || '0',
    containertype: multiExtract([/Cargo[:\t]+(.+)/i]) || '0',
    containernummer: (() => {
      const result = multiExtract([
        /Container no[:\t ]+(\w{4}U\d{7})/i,
        /([A-Z]{4}U\d{7})/i
      ]);
      return /^[A-Z]{4}U\d{7}$/.test(result || '') ? result : '';
    })(),
    temperatuur: multiExtract([/Temperature[:\t ]+([\-\d]+°C)/i]) || '0',
   datum: (() => {
  const match = text.match(/Date[:\t ]+(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!match) return '0';
  const [_, day, monthStr, year] = match;
  const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
  const maand = months[monthStr.toLowerCase().slice(0,3)];
  return `${day.padStart(2, '0')}-${maand}-${year}`;
})(),
ladenOfLossen: data.isLossenOpdracht ? 'Lossen' : 'Laden',
inleverBootnaam: multiExtract([/Vessel[:\t ]+(.+)/i]) || '0',
inleverRederij: multiExtract([/Carrier[:\t ]+(.+)/i]) || '0',

tijd: (() => {
  const match = text.match(/Date[:\t ].+\s+(\d{2}:\d{2})/i);
  return match ? `${match[1]}:00` : '';
})(),
    inleverBestemming: multiExtract([/Final destination[:\t ]+(.+)/i]) || '0',
    dropoffTerminal: multiExtract([/Drop[-\s]?off terminal[:\t ]+(.+)/i]) || '0',
    pickupTerminal: multiExtract([/Pick[-\s]?up terminal[:\t ]+(.+)/i]) || '0',
    gewicht: multiExtract([/Weight[:\t ]+(\d+\s?kg)/i]) || '0',
    volume: multiExtract([/Volume[:\t ]+(\d+(?:\.\d+)?\s?m3)/i]) || '0',
    colli: multiExtract([/Colli[:\t ]+(\d+)/i]) || '0',
    lading: ladingFromBlock || multiExtract([/Description of goods[:\t ]+(.+)/i]) || '0',
    imo: multiExtract([/IMO[:\t ]+(\d+)/i]) || '0',
    unnr: multiExtract([/UN[:\t ]+(\d+)/i]) || '0',
    brix: multiExtract([/Brix[:\t ]+(\d+)/i]) || '0',
    klantnaam: regels[0] || '0',
    klantadres: regels[1] || '0',
    klantpostcode: postcodeMatch?.[1] || '0',
    klantplaats: postcodeMatch?.[2] || '0',
    klantAdresVolledig: '0',
    opdrachtgeverNaam: 'JORDEX FORWARDING',
    opdrachtgeverAdres: 'AMBACHTSWEG 6',
    opdrachtgeverPostcode: '3161GL',
    opdrachtgeverPlaats: 'RHOON',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'TRANSPORT@JORDEX.COM',
    opdrachtgeverBTW: 'NL815340011B01',
    opdrachtgeverKVK: '39012345',
    terminal: '0',
    rederijCode: '0',
    containertypeCode: '0'
  };
// 🧪 ADR evaluatie op basis van IMO en UNNR
if (data.imo !== '0' || data.unnr !== '0') {
  data.adr = 'Waar';
} else {
  data.adr = 'Onwaar';
  delete data.imo;
  delete data.unnr;
  delete data.brix;
}
  data.isLossenOpdracht = !!data.containernummer && data.containernummer !== '0';
if (!data.isLossenOpdracht) {
  const from = multiExtract([/From[:\t ]+(.+)/i]) || '';
  const to = multiExtract([/To[:\t ]+(.+)/i]) || '';
  if (from.toLowerCase().includes('rotterdam') || from.toLowerCase().includes('nl')) {
    data.isLossenOpdracht = false;
  } else if (to.toLowerCase().includes('rotterdam') || to.toLowerCase().includes('nl')) {
    data.isLossenOpdracht = true;
  }
}

  try {
    const pickupInfo = await getTerminalInfo(data.pickupTerminal) || {};
    const dropoffInfo = await getTerminalInfo(data.dropoffTerminal) || {};
    data.terminal = await getTerminalInfo(data.dropoffTerminal) || '0';
    data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';
    const baseRederij = data.rederij.includes(' - ') ? data.rederij.split(' - ')[1] : data.rederij;
    data.rederijCode = await getRederijNaam(baseRederij) || '0';

    const formatVoorgemeld = (value) => !value ? 'Onwaar' : (value.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar');

    data.locaties = [
      {
        volgorde: '0', actie: 'Opzetten',
        naam: data.pickupTerminal || '', adres: pickupInfo.adres || '', postcode: pickupInfo.postcode || '', plaats: pickupInfo.plaats || '', land: pickupInfo.land || 'NL',
        voorgemeld: formatVoorgemeld(pickupInfo.voorgemeld), aankomst_verw: '', tijslot_van: '', tijslot_tm: '', portbase_code: pickupInfo.portbase_code || '', bicsCode: pickupInfo.bicsCode || ''
      },
      {
        volgorde: '0', actie: data.isLossenOpdracht ? 'Lossen' : 'Laden',
        naam: data.klantnaam, adres: data.klantadres, postcode: data.klantpostcode, plaats: data.klantplaats, land: 'NL',
        voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '', portbase_code: '', bicsCode: ''
      },
      {
        volgorde: '0', actie: 'Afzetten',
        naam: data.dropoffTerminal || '', adres: dropoffInfo.adres || '', postcode: dropoffInfo.postcode || '', plaats: dropoffInfo.plaats || '', land: dropoffInfo.land || 'NL',
        voorgemeld: formatVoorgemeld(dropoffInfo.voorgemeld), aankomst_verw: '', tijslot_van: '', tijslot_tm: '', portbase_code: dropoffInfo.portbase_code || '', bicsCode: dropoffInfo.bicsCode || ''
      }
    ];
  } catch (e) {
    console.warn('⚠️ Fout in terminal of rederij lookup:', e);
  }

  if (!data.referentie || data.referentie === '0') {
    console.warn('⚠️ Referentie (terminal) ontbreekt – wordt leeg gelaten in XML');
  }

  if ((!data.ritnummer || data.ritnummer === '0') && parsed.info?.Title?.includes('OE')) {
    const match = parsed.info.Title.match(/(O[EI]\d{7})/i);
    if (match) {
      data.ritnummer = match[1];
      console.log('🆗 Ritnummer herkend uit bestandsnaam:', data.ritnummer);
    }
  }
const pickupInfo = await getTerminalInfo(data.pickupTerminal) || { adres: '', postcode: '', plaats: '', land: 'NL' };
const dropoffInfo = await getTerminalInfo(data.dropoffTerminal) || { adres: '', postcode: '', plaats: '', land: 'NL' };

  console.log('📍 Volledige locatiestructuur gegenereerd:', data.locaties);
  console.log('✅ Eindwaarde opdrachtgever:', data.opdrachtgeverNaam);
  console.log('📤 DATA OBJECT UIT PARSEJORDEX:', JSON.stringify(data, null, 2));
  console.log('📤 PARSE RESULTAAT:', JSON.stringify(data, null, 2));
  
  return data;
}
