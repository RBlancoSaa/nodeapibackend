// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

function logResult(label, value) {
  const val = value || '';
  console.log(`🔍 ${label}:`, val);
  return val;
}

export default async function parseDFDS(pdfBuffer) {
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

  // 📌 Algemene info
  const ritnummer = logResult('ritnummer', text.match(/\bSFIM\d{7}\b/)?.[0]);
  const bootnaam = logResult('bootnaam', text.match(/Vaartuig\s+(.+?)\s+Reis/i)?.[1]);
  const rederij = logResult('rederij', text.match(/Rederij\s+(.+)/i)?.[1]);
  const loshaven = logResult('loshaven', text.match(/Loshaven\s+([A-Z]{5})\s*-\s*(.+)/i)?.[2]?.trim());
  const fromLocatie = logResult('from', text.match(/From:\s*(.+)/i)?.[1]?.trim() || '');
  const toLocatie = logResult('to', text.match(/To:\s*(.+)/i)?.[1]?.trim() || '');
  const klantNaam = logResult('klant.naam', regels.find(r => r.toLowerCase().includes('dropoff'))?.match(/Dropoff\s+(.+)/i)?.[1]);
  const klantAdres = logResult('klant.adres', regels.find(r => r.toLowerCase().includes('adres'))?.split('Adres:')[1]?.trim() || '');
  const klantPostcode = logResult('klant.postcode', regels.find(r => r.toLowerCase().includes('postcode'))?.split('Postcode:')[1]?.trim() || '');
  const klantPlaats = logResult('klant.plaats', regels.find(r => r.toLowerCase().includes('plaats'))?.split('Plaats:')[1]?.trim() || '');
  
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
    
  const instructieRegel = regels.find(r =>
      r.toLowerCase().includes('opmerking') || r.toLowerCase().includes('remark')
    );
    if (instructieRegel) {
      instructies = instructieRegel.split(':')[1]?.trim() || '';
    }
    logResult('instructies', instructies);


  // 📦 Containers
  const containers = [];

  for (const regel of regels) {
    const match = regel.match(/\b([A-Z]{4}\d{7})\b\s+(.+?)\s+-\s+([\d.]+)\s*m3.*Zegel:\s*(\S+)/i);
    if (!match) continue;

    const containernummer = logResult('containernummer', match[1]);
    const containertypeRaw = logResult('containertype', match[2]);
    const zegel = logResult('zegel', match[4]);
    const containertypeCode = await getContainerTypeCode(containertypeRaw);

    const lading = logResult('lading', regels.find(r => r.match(/\d+\s*CARTON|BAG|PALLET|BARREL/i)) || '');
    const referentie = logResult('referentie', text.match(/Dropoff\s+(\d{7,})/)?.[1] || '');

    // Tijd en datum
    const tijdMatch = regels.find(r => r.match(/\d{2}:\d{2}/))?.match(/(\d{2}):(\d{2})/);
    const tijd = tijdMatch ? `${tijdMatch[1]}:${tijdMatch[2]}:00` : '';
    const dateMatch = regels.find(r => r.toLowerCase().includes('pickup'))?.match(/(\d{2})-(\d{2})-(\d{4})/);
    logResult('tijd', tijd);

    if (dateMatch) {
      const [_, dag, maand, jaar] = dateMatch;
      laadDatum = `${dag}-${maand}-${jaar}`;
    } else {
      const nu = new Date();
      laadDatum = `${nu.getDate().toString().padStart(2, '0')}-${(nu.getMonth() + 1).toString().padStart(2, '0')}-${nu.getFullYear()}`;
    }
    logResult('datum', laadDatum);
    logResult('tijd');

      let adr = 'Onwaar';
      for (const regel of regels) {
        if (/ADR|UN\d{4}|IMO|Lithium|Hazardous/i.test(regel)) {
          adr = 'Waar';
          break;
        }
      }
          // 📦 Robuuste containerwaarden uit regels
      let colli = '0', volume = '0', gewicht = '0';

      for (let regel of regels) {
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
      const doKey = dropoffTerminalAdres || data.dropoff_terminal || '';
      console.log('🔑 doKey terminal lookup:', doKey);

      // 🧠 Terminalinformatie ophalen met fallback
      const pickupInfo = await getTerminalInfoMetFallback(puKey);
      const dropoffInfo = await getTerminalInfoMetFallback(doKey);

      // 🧾 Klantgegevens uit Pick-up blok halen (na "Pick-up terminal")
      const puIndex = regels.findIndex(line => /^Pick[-\s]?up terminal$/i.test(line));
      const klantregels = regels
        .slice(puIndex + 1, puIndex + 8)
        .filter(l => l && !/^Cargo:|^Reference/i.test(l))
        .slice(0, 4);

      // 💡 Veldextractie per regel (ruwe benadering)
      const klantnaam = klantregels[0] || '';
      const klantadres = klantregels[1] || '';
      const klantpostcode = klantregels[2]?.match(/\d{4}\s?[A-Z]{2}/)?.[0] || '';
      const klantplaats = klantregels[2]?.replace(klantpostcode, '').trim() || '';

      console.log('🔍 Klantgegevens uit Pick-up blok:', klantregels);
      console.log('👉 naam:', data.klantnaam);
      console.log('👉 adres:', data.klantadres);
      console.log('👉 postcode:', data.klantpostcode);
      console.log('👉 plaats:', data.klantplaats);

    const data = {
      ritnummer,
      referentie,
      colli,
      volume,
      gewicht,
      lading,
      containernummer,
      containertype: containertypeRaw,
      containertype_code: containertypeCode,
      zegel,
      temperatuur: logResult('temperatuur', regels.find(r => r.includes('°C'))?.match(/(\d{1,2})/)?.[1] || ''),
      datum: laadDatum,
      tijd,
      instructies,
      laadreferentie: referentie,
      inleverreferentie: referentie,
      bootnaam,
      rederij,
      inlever_bootnaam: bootnaam,
      inlever_rederij: rederij,
      inlever_bestemming: '',
      tarra: '0',
      brutogewicht: gewicht,
      geladen_gewicht: gewicht,
      cbm: volume,
      brix: '0',
      adr,
      documentatie: '',
      tar: '',
      type: '',
      opdrachtgever_naam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
      opdrachtgever_adres: 'WOLGAWEG 3',
      opdrachtgever_postcode: '3198 LR',
      opdrachtgever_plaats: 'ROTTERDAM',
      opdrachtgever_telefoon: '010-1234567',
      opdrachtgever_email: 'nl-rtm-operations@dfds.com',
      opdrachtgever_btw: 'NL007129099B01',
      opdrachtgever_kvk: '24232781',
      klantnaam,
      klantadres,
      klantpostcode,
      klantplaats,
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
        naam: data.klantnaam || '',
        adres: data.klantadres || '',
        postcode: data.klantpostcode || '',
        plaats: data.klantplaats || '',
        land: 'NL'
        // geen andere velden hier
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
    // Fallback voor referentie
    if (!referentie || referentie === '0') {
      console.warn('⚠️ Referentie (terminal) ontbreekt – wordt leeg gelaten in XML');
    }

    // Fallback voor ritnummer
    if ((!ritnummer || ritnummer === '0') && parsed.info?.Title?.includes('OE')) {
      const match = parsed.info.Title.match(/(O[EI]\d{7})/i);
      if (match) {
        data.ritnummer = match[1];
      }
    }

    // Log per container
    console.log('📤 DFDS CONTAINERDATA:', JSON.stringify(data, null, 2));
    containers.push(data);

    console.log('📦 LOCATIE 0 (pickup):', JSON.stringify(data.locaties[0], null, 2));
    console.log('📦 LOCATIE 1 (klant):', JSON.stringify(data.locaties[1], null, 2));
    console.log('📦 LOCATIE 2 (dropoff):', JSON.stringify(data.locaties[2], null, 2));
    console.log('🧪 Terminalinfo (pickup):', pickupInfo);
    console.log('🧪 Terminalinfo (dropoff):', dropoffInfo);
    }

  return { containers };
}