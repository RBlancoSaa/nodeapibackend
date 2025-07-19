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


  // ...boven je container-extractie...
const containerRegels = [];

// Vul containerRegels met alle containers uit de PDF
for (let i = 0; i < filteredRegelsIntro.length; i++) {
  const regel = filteredRegelsIntro[i];
  const match = regel.match(/\b([A-Z]{4}\d{7})\b\s+(.+?)\s+-\s+([\d.]+)\s*m3/i);
  if (match) {
    const containernummer = match[1];
    const containertypeRaw = match[2];
    const volumeRaw = match[3];
    const volgendeRegels = filteredRegelsIntro.slice(i + 1, i + 5).join(' ');
    const zegelMatch = volgendeRegels.match(/Zegel:\s*([A-Z0-9]+)/i);
    const zegel = zegelMatch?.[1] || '';
    containerRegels.push({
      regelIndex: i,
      containernummer,
      containertypeRaw,
      volumeRaw,
      zegel
    });
  }
}
for (const container of containerRegels) {
// 📦 Containers
const containers = [];
for (const container of containerRegels) {
  // Unieke containerdata
  const containernummer = container.containernummer;
  const containertypeRaw = container.containertypeRaw;
  const volume = container.volumeRaw;
  const zegel = container.zegel;
  const containertypeCode = await getContainerTypeCode(containertypeRaw);

  const data = {
  // Algemeen
  ritnummer: logResult('ritnummer', ritnummer),
  referentie: logResult('referentie', referentie),
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
  ],

  // Terminal info
  terminal: logResult('terminal', terminal)
};


for (const container of containerRegels) {
  const containernummer = container.containernummer;
  const containertypeRaw = container.containertypeRaw;
  const volume = container.volumeRaw;
  const zegel = container.zegel;
   const containertypeCode = await getContainerTypeCode(containertypeRaw);
          const blacklist = [
        'FENEX', 'TLN', 'registry clerk', 'insurance cover', 'Dutch legislation',
        'www.dfds.com', 'KvK', 'Rabobank', 'BIC', 'BTW', 'Operations', 'Accounts', 'NL-RTM-accounts'
      ];

for (let i = 0; i < filteredRegelsIntro.length; i++) {
  const regel = filteredRegelsIntro[i];
  const match = regel.match(/\b([A-Z]{4}\d{7})\b\s+(.+?)\s+-\s+([\d.]+)\s*m3/i); // bijv: EITU9306970 40ft HC - 76.3 m3
  if (match) {
    const containernummer = logResult('containernummer', match[1]);
    const containertypeRaw = logResult('containertype', match[2]);
    const volumeRaw = logResult('volume', match[3]);

    const volgendeRegels = filteredRegelsIntro.slice(i + 1, i + 5).join(' ');
    const zegelMatch = volgendeRegels.match(/Zegel:\s*([A-Z0-9]+)/i);
    const zegel = logResult('zegel', zegelMatch?.[1] || '');

    containerRegels.push({
      regelIndex: i,
      containernummer,
      containertypeRaw,
      volumeRaw,
      zegel
    });
  }
}

console.log(`📦 Aantal containers gevonden: ${containerRegels.length}`);




  for (const regel of filteredRegelsIntro) {
    const match = regel.match(/\b([A-Z]{4}\d{7})\b\s+(.+?)\s+-\s+([\d.]+)\s*m3.*Zegel:\s*(\S+)/i);
    if (!match) continue;

      const regelsGefilterd = filteredRegelsIntro.filter(r =>
        !blacklist.some(term => r.toLowerCase().includes(term.toLowerCase()))
      );
    const lading = logResult('lading', regels.find(r => r.match(/\d+\s*CARTON|BAG|PALLET|BARREL/i)) || '');
    const referentie = (() => {
    const pickupBlock = text.match(/Pickup[\s\S]+?(?=Lossen|Drop[-\s]?off|Extra Information|\*|$)/i)?.[0] || '';
    const match = pickupBlock.match(/([A-Z0-9]{9})\s+\d{2}-\d{2}-\d{4}/); // zoals EIRU123456 11-07-2025
    return match?.[1]?.trim() || '';
  })();
  
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


    // Tijd en datum
    const tijdMatch = filteredRegelsIntro .find(r => r.match(/\d{2}:\d{2}/))?.match(/(\d{2}):(\d{2})/);
    const tijd = tijdMatch ? `${tijdMatch[1]}:${tijdMatch[2]}:00` : '';
    const dateMatch = filteredRegelsIntro .find(r => r.toLowerCase().includes('pickup'))?.match(/(\d{2})-(\d{2})-(\d{4})/);
    logResult('tijd', tijd);

    if (dateMatch) {
      const [_, dag, maand, jaar] = dateMatch;
      laadDatum = `${dag}-${maand}-${jaar}`;
    } else {
      const nu = new Date();
      laadDatum = `${nu.getDate().toString().padStart(2, '0')}-${(nu.getMonth() + 1).toString().padStart(2, '0')}-${nu.getFullYear()}`;
    }
    logResult('datum', laadDatum);
    logResult('tijd', tijd);

      let adr = 'Onwaar';
      for (const regel of filteredRegelsIntro ) {
        if (/ADR|UN\d{4}|IMO|Lithium|Hazardous/i.test(regel)) {
          adr = 'Waar';
          break;
        }
      }
          // 📦 Robuuste containerwaarden uit regels
      let colli = '0', volume = '0', gewicht = '0';

      for (let regel of regelsGefilterd) {
        const lower = regel.toLowerCase();

        if (lower.includes('kg') && gewicht === '0') {
          const match = regel.match(/([\d.,]+)\s*kg/i);
          if (match) {
            gewicht = match[1].replace(',', '.');
            if (gewicht.includes('.')) {
              gewicht = Math.round(parseFloat(gewicht)).toString();
            }
          }
        }

        if (lower.includes('m³') && volume === '0') {
          const match = regel.match(/([\d.,]+)\s*m³/i);
          if (match) {
            volume = match[1].replace(',', '.');
          }
        }

        const colliMatch = regel.match(/^\d{2,5}$/);
        if (colliMatch && colli === '0') {
          colli = colliMatch[0];
        }
      }

      // 🧪 Logging
      logResult('colli', colli);
      logResult('volume', volume);
      logResult('gewicht', gewicht);

      // 🎯 Terminalnaam (pickup) ophalen voor lookup key
      const pickupTerminalMatch = text.match(/Pick[-\s]?up terminal[\s\S]+?Address:\s*(.+)/i);
      const puKey = pickupTerminalMatch?.[1]?.trim() || '';

      // 🎯 Terminalnaam (dropoff) ophalen voor lookup key
      const dropoffTerminalMatch = text.match(/Drop[-\s]?off terminal[\s\S]+?Address:\s*(.+)/i);
      const dropoffTerminalAdres = dropoffTerminalMatch?.[1]?.trim() || '';
      const doKey = dropoffTerminalAdres || '';
      console.log('🔑 doKey terminal lookup:', doKey);

      // 🧠 Terminalinformatie ophalen met fallback
      const pickupInfo = await getTerminalInfoMetFallback(puKey);
      const dropoffInfo = await getTerminalInfoMetFallback(doKey);

      // 🔧 Opschonen: verwijder voetteksten/disclaimers die voor 'Transport informatie' staan
      const startIndex = regels.findIndex(r => /Transport informatie/i.test(r));
      const filteredRegels = regels.slice(startIndex);

      // 🔍 Klantgegevens (Lossen-blok)
      const lossenIndex = filteredRegels.findIndex(line => /^Lossen$/i.test(line));
      const klantregels = filteredRegels.slice(lossenIndex + 1, lossenIndex + 5).filter(Boolean);

      const klantnaam = klantregels[0] || '';
      const klantadres = klantregels[1] || '';
      const klantpostcode = klantregels[2]?.match(/\d{4}\s?[A-Z]{2}/)?.[0] || '';
      const klantplaats = klantregels[2]?.replace(klantpostcode, '').trim() || '';

      
        // Laadreferentie ophalen uit Lossen blok
      const laadreferentie = (() => {
      const block = text.match(/Lossen[\s\S]+?(?=Drop[-\s]?off|Extra Information|\*|$)/i)?.[0] || '';
      const match = block.match(/I\d{8}/i);
      return match?.[0] || '';
    })();

          // const data = drop off informatie
      const inleverreferentie = (() => {
      const dropoffBlock = text.match(/Drop[-\s]?off[\s\S]+?(?=Extra Information|Goederen informatie|\*|$)/i)?.[0] || '';
      const match = dropoffBlock.match(/Reference[:\t ]+([A-Z0-9\-]+)/i);
        return match?.[1]?.trim() || '';
      })();

      console.log('🔍 Klantgegevens uit Pick-up blok:', klantregels);
      console.log('👉 naam:', klantnaam);
      console.log('👉 adres:', klantadres);
      console.log('👉 postcode:', klantpostcode);
      console.log('👉 plaats:', klantplaats);
      logResult('klantnaam', klantnaam);
      logResult('klantadres', klantadres);
      logResult('klantpostcode', klantpostcode);
      logResult('klantplaats', klantplaats);

    const data = {
      ritnummer: logResult('ritnummer', ritnummer),
      referentie: logResult('referentie', (() => {
        const blok = text.match(/Lossen[\s\S]+?(?=Drop[-\s]?off|Extra Information|\*|$)/i)?.[0] || '';
        const match = blok.match(/I\d{8}/i); // of ander patroon
        return match?.[0] || '0';
      })()),
      
      // const data = geladen container informatie
      containertype: logResult('containertype', containertypeRaw),
      containertypeCode: logResult('containertypeCode', containertypeCode || ''),
      containernummer: logResult('containernummer', containernummer),
      zegel: logResult('zegel', zegel),
      datum: logResult('datum', laadDatum),
      tijd: logResult('tijd', tijd),
      adr: logResult('adr', adr || ''),
      laadreferentie: logResult('laadreferentie', laadreferentie),


      inleverBootnaam: logResult('inleverBootnaam', bootnaam || ''),
      inleverRederij: logResult('inleverRederij', rederij || ''),
      inleverreferentie: logResult('inleverreferentie', inleverreferentie),
      
      // const data = container box info
      tarra: logResult('tarra', '0'),
      geladenGewicht: logResult('geladenGewicht', '0'),
      brutogewicht: logResult('brutogewicht', gewicht || '0'),
      cbm: logResult('cbm', volume || '0'),
      brix: logResult('brix', '0'),
      colli: logResult('colli', colli),
      volume: logResult('volume', volume),
      gewicht: logResult('gewicht', gewicht),
      lading: logResult('lading', lading),

      // const data = doc tar type
      documentatie: logResult('documentatie', ''),
      tar: logResult('tar', ''),
      type: logResult('type', ''),
      
      // const data = opdrachtgever
      opdrachtgeverNaam: logResult('opdrachtgeverNaam', 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM BV'),
      opdrachtgeverAdres: logResult('opdrachtgeverAdres', 'WOLGAWEG 3'),
      opdrachtgeverPostcode: logResult('opdrachtgeverPostcode', '3198 LR'),
      opdrachtgeverPlaats: logResult('opdrachtgeverPlaats', 'ROTTERDAM'),
      opdrachtgeverEmail: logResult('opdrachtgeverEmail', 'nl-rtm-operations@dfds.com'),
      opdrachtgeverBTW: logResult('opdrachtgeverBTW', 'NL007129099B01'),
      opdrachtgeverKVK: logResult('opdrachtgeverKVK', '24232781'),

      // const data = klant
      klantnaam: logResult('klantnaam', klantnaam || ''),
      klantadres: logResult('klantadres', klantadres || ''),
      klantpostcode: logResult('klantpostcode', klantpostcode || ''),
      klantplaats: logResult('klantplaats', klantplaats || ''),

        locaties: [
            {
        volgorde: '0',    
        actie: 'Opzetten',
        naam: pickupInfo.naam   || puKey,
        adres: pickupInfo.adres    || '',
        postcode: pickupInfo.postcode || '',
        plaats: pickupInfo.plaats  || '',
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
        adres: dropoffInfo.adres     || '',
        postcode: dropoffInfo.postcode  || '',
        plaats: dropoffInfo.plaats   || '',
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


    // ⬇️ Dan pas terminal- en rederij-verwerking
    try {
      data.terminal = await getTerminalInfo(data.dropoffTerminal) || '0';
      data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';

      const baseRederij = data.rederij.includes(' - ')
        ? data.rederij.split(' - ')[1].trim()
        : data.rederij.trim();

      const officiëleRederij = await getRederijNaam(baseRederij);
      console.log('🎯 MATCH uit rederijenlijst:', officiëleRederij);

      if (officiëleRederij && officiëleRederij !== '0') {
        data.rederij = officiëleRederij;
        data.inleverRederij = officiëleRederij;
      }
    } catch (e) {
      console.warn('⚠️ Fout in terminal of rederij lookup:', e);
    }
    // Fallback voor referentie
    if (!referentie || referentie === '0') {
      console.warn('⚠️ Referentie (terminal) ontbreekt – wordt leeg gelaten in XML');
    }

    // Fallback voor ritnummer op basis van SFIM-code in PDF-titel
    if ((!ritnummer || ritnummer === '0') && parsed.info?.Title?.includes('SFIM')) {
      const match = parsed.info.Title.match(/\bSFIM\d{7}\b/i);
      if (match) {
        data.ritnummer = match[0];
      }
    }

      try {
    data.terminal = await getTerminalInfo(data.dropoffTerminal) || '0';
    data.containertypeCode = await getContainerTypeCode(data.containertype) || '0';

    const baseRederij = data.rederij.includes(' - ')
      ? data.rederij.split(' - ')[1].trim()
      : data.rederij.trim();

    const officiëleRederij = await getRederijNaam(baseRederij);
    console.log('🎯 MATCH uit rederijenlijst:', officiëleRederij);

    if (officiëleRederij && officiëleRederij !== '0') {
      data.rederij = officiëleRederij;
      data.inleverRederij = officiëleRederij;
    }
  } catch (e) {
    console.warn('⚠️ Fout in terminal of rederij lookup:', e);
  }
    // Log per container
    console.log('📤 DFDS CONTAINERDATA:', JSON.stringify(data, null, 2));
    console.log('📦 LOCATIE 0 (pickup):', JSON.stringify(data.locaties[0], null, 2));
    console.log('📦 LOCATIE 1 (klant):', JSON.stringify(data.locaties[1], null, 2));
    console.log('📦 LOCATIE 2 (dropoff):', JSON.stringify(data.locaties[2], null, 2));
    console.log('🧪 Terminalinfo (pickup):', pickupInfo);
    console.log('🧪 Terminalinfo (dropoff):', dropoffInfo);
    }

  // Logging per container
  console.log('📤 DFDS CONTAINERDATA:', JSON.stringify(data, null, 2));
  containers.push(data);
}

return containers;
}
}
}