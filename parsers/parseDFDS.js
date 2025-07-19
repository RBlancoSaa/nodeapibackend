// parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfo,
  getRederijNaam,
  getContainerTypeCode,
  getTerminalInfoFallback,
  getTerminalInfoMetFallback
} from '../utils/lookups/terminalLookup.js';

function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}

export default async function parseDFDS(pdfBuffer) {
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

  const ritnummerMatch = text.match(/\bSFIM\d{7}\b/i);

  // ❌ Kop- en voettekstregels verwijderen
  const filteredRegelsIntro = regels.filter(r => {
    const lower = r.toLowerCase();
    return !(
      lower.includes('fenex') ||
      lower.includes('tln algemene betalingsvoorwaarden') ||
      lower.includes('op al onze werkzaamheden is nederlands recht') ||
      lower.includes('voor rekening en risico van de opdrachtgever') ||
      lower.includes('dekking voor opruimingskosten') ||
      lower.includes('kosteloos toegezonden')
    );
  });

  // 🔍 Multi-pattern extractor: zoekt de eerste waarde die matcht op een van de patronen
  const multiExtract = (patterns) => {
    for (const pattern of patterns) {
      const found = filteredRegelsIntro.find(line => pattern.test(line));
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


  // 📌 Algemene info
  const ritnummer = ritnummerMatch?.[0] || '';
  logResult('ritnummer', ritnummer);

// 📦 Containerregels opsporen
const containerRegels = [];
for (let i = 0; i < filteredRegelsIntro.length; i++) {
  const regel = filteredRegelsIntro[i];
  const match = regel.match(/\b([A-Z]{4}\d{7})\b\s+(.+?)\s+-\s+([\d.]+)\s*m3/i);
  if (match) {
    const containernummer = match[1];
    const containertypeRaw = match[2];
    const volumeRaw = match[3];
    const volgendeRegels = filteredRegelsIntro.slice(i + 1, i + 5).join(' ');
    const zegel = volgendeRegels.match(/Zegel:\s*([A-Z0-9]+)/i)?.[1] || '';
    containerRegels.push({ containernummer, containertypeRaw, volumeRaw, zegel });
  }
}
console.log(`📦 Aantal containers gevonden: ${containerRegels.length}`);

  // ✅ Klantgegevens vanuit "Lossen"-blok
  const lossenBlokMatch = text.match(/Lossen\s*\n([\s\S]+?)(?=\n(?:Drop[-\s]?off|Pickup|Extra Information|$))/i);
  const lossenBlok = lossenBlokMatch?.[1] || '';
  const lossenRegels = lossenBlok.split('\n').map(r => r.trim()).filter(Boolean);

  const klantNaam = lossenRegels[0] || '';
  const klantAdres = lossenRegels[1] || '';
  const klantPostcode = klantAdres.match(/\d{4}\s?[A-Z]{2}/)?.[0] || '';
  const klantPlaats = klantAdres.replace(klantPostcode, '').replace(',', '').trim();

  logResult('klantNaam', klantNaam);
  logResult('klantAdres', klantAdres);
  logResult('klantPostcode', klantPostcode);
  logResult('klantPlaats', klantPlaats);

  const bootnaam = logResult('bootnaam', text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1]);
  const rederij = logResult('rederij', multiExtract([/Rederij[:\t ]+(.+)/i]));
  const inleverRederij = logResult('inleverRederij', rederij);
  const loshaven = logResult('loshaven', text.match(/Loshaven\s+([A-Z]{5})\s*-\s*(.+)/i)?.[2]?.trim());
  const fromLocatie = logResult('from', text.match(/From:\s*(.+)/i)?.[1]?.trim() || '');
  const toLocatie = logResult('to', text.match(/To:\s*(.+)/i)?.[1]?.trim() || '');

    let laadDatum = '';
    let instructies = '';

    let isLossenOpdracht = false;
    if (fromLocatie && fromLocatie.toLowerCase().includes('be')) {
      isLossenOpdracht = true;
    } else if (loshaven && loshaven.toLowerCase().includes('rotterdam')) {
      isLossenOpdracht = true;
    } else if (toLocatie && toLocatie.toLowerCase().includes('rotterdam')) {
      isLossenOpdracht = true;
    }
    
  const instructieRegel = filteredRegelsIntro.find(r =>
      r.toLowerCase().includes('opmerking') || r.toLowerCase().includes('remark')
    );
    if (instructieRegel) {
      instructies = instructieRegel.split(':')[1]?.trim() || '';
    }
    logResult('instructies', instructies);


    // 🧩 Per container verwerken tot los data-object
const containers = [];

for (const regel of containerRegels) {
  const containernummer = logResult('containernummer', regel.containernummer);
  const containertypeRaw = logResult('containertype', regel.containertypeRaw);
  const containertypeCode = await getContainerTypeCode(containertypeRaw);
  const volume = logResult('volume', regel.volumeRaw);
  const zegel = logResult('zegel', regel.zegel);

  const referentie = (() => {
    const pickupBlock = text.match(/Pickup[\s\S]+?(?=Lossen|Drop[-\s]?off|Extra Information|\*|$)/i)?.[0] || '';
    const match = pickupBlock.match(/([A-Z0-9]{9})\s+\d{2}-\d{2}-\d{4}/); 
    return match?.[1]?.trim() || '';
  })();

  const tijdMatch = filteredRegelsIntro.find(r => r.match(/\d{2}:\d{2}/))?.match(/(\d{2}):(\d{2})/);
  const tijd = tijdMatch ? `${tijdMatch[1]}:${tijdMatch[2]}:00` : '';
  const dateMatch = filteredRegelsIntro.find(r => r.toLowerCase().includes('pickup'))?.match(/(\d{2})-(\d{2})-(\d{4})/);
  const laadDatum = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : new Date().toLocaleDateString('nl-NL');

  let adr = 'Onwaar';
  for (const r of filteredRegelsIntro) {
    if (/ADR|UN\d{4}|IMO|Lithium|Hazardous/i.test(r)) adr = 'Waar';
  }

  let colli = '0', gewicht = '0';
  for (const r of filteredRegelsIntro) {
    if (gewicht === '0' && /[\d.,]+\s*kg/i.test(r)) gewicht = r.match(/([\d.,]+)\s*kg/i)?.[1]?.replace(',', '.') || '0';
    if (colli === '0' && /^\d{2,5}$/.test(r)) colli = r.trim();
  }

  const pickupKey = text.match(/Pick[-\s]?up terminal[\s\S]+?Address:\s*(.+)/i)?.[1]?.trim() || '';
  const dropoffKey = text.match(/Drop[-\s]?off terminal[\s\S]+?Address:\s*(.+)/i)?.[1]?.trim() || '';
  const pickupInfo = await getTerminalInfoMetFallback(pickupKey);
  const dropoffInfo = await getTerminalInfoMetFallback(dropoffKey);

  const laadreferentie = (() => {
    const block = text.match(/Lossen[\s\S]+?(?=Drop[-\s]?off|Extra Information|\*|$)/i)?.[0] || '';
    const match = block.match(/I\d{8}/i);
    return match?.[0] || '';
  })();

  const inleverreferentie = (() => {
    const dropoffBlock = text.match(/Drop[-\s]?off[\s\S]+?(?=Extra Information|Goederen informatie|\*|$)/i)?.[0] || '';
    const match = dropoffBlock.match(/Reference[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || '';
  })();

  const data = {
    ritnummer,
    containernummer,
    containertype: containertypeRaw,
    containertypeCode,
    zegel,
    referentie,
    datum: laadDatum,
    tijd,
    adr,
    laadreferentie,
    inleverBootnaam: bootnaam,
    inleverRederij: rederij,
    inleverreferentie,
    brutogewicht: gewicht,
    volume,
    gewicht,
    colli,
    cbm: volume,
    brix: '0',
    tarra: '0',
    geladenGewicht: '0',
    documentatie: '',
    tar: '',
    type: '',
    opdrachtgeverNaam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM BV',
    opdrachtgeverAdres: 'WOLGAWEG 3',
    opdrachtgeverPostcode: '3198 LR',
    opdrachtgeverPlaats: 'ROTTERDAM',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781',
    klantnaam: klantNaam,
    klantadres: klantAdres,
    klantpostcode: klantPostcode,
    klantplaats: klantPlaats,
    locaties: [
      {
        volgorde: '0',
        actie: 'Opzetten',
        naam: pickupInfo.naam || pickupKey,
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
        actie: isLossenOpdracht ? 'Lossen' : 'Laden',
        naam: klantNaam,
        adres: klantAdres,
        postcode: klantPostcode,
        plaats: klantPlaats,
        land: 'NL'
      },
      {
        volgorde: '0',
        actie: 'Afzetten',
        naam: dropoffInfo.naam || dropoffKey,
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

  // Logging per container
  console.log('📤 DFDS CONTAINERDATA:', JSON.stringify(data, null, 2));
  containers.push(data);
}

return containers;
}