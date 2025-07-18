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

  const klantregel = regels.find(r => r.toLowerCase().includes('lossen') || r.toLowerCase().includes('dropoff')) || '';
  const klantNaam = logResult('klant.naam', klantregel.match(/Lossen\s+(.+)/i)?.[1]);
  const klantAdres = logResult('klant.adres', klantregel.match(/Adres[:\s]+(.+)/i)?.[1]);
  const klantPostcode = logResult('klant.postcode', klantregel.match(/Postcode[:\s]+(.+)/i)?.[1]);
  const klantPlaats = logResult('klant.plaats', klantregel.match(/Plaats[:\s]+(.+)/i)?.[1]);

  const locatie1 = await getTerminalInfoMetFallback('DFDS Warehousing Rotterdam BV Europoort');
  const locatie3 = await getTerminalInfoMetFallback('DFDS Warehousing Rotterdam BV Europoort');

  const algemeneData = {
    ritnummer,
    bootnaam,
    rederij,
    inleverBootnaam: bootnaam,
    inleverRederij: rederij,
    opdrachtgeverNaam: 'DFDS Warehousing Rotterdam BV',
    opdrachtgeverAdres: 'Wolgaweg 5, 3198 LR Rotterdam - Europoort, THE NETHERLANDS',
    opdrachtgeverPostcode: '3198 LR',
    opdrachtgeverPlaats: 'ROTTERDAM',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW: 'NL007129099B01',
    opdrachtgeverKVK: '24232781',
    locaties: [
      {
        volgorde: '0',
        actie: 'Opzetten',
        naam: locatie1.naam,
        adres: locatie1.adres,
        postcode: locatie1.postcode,
        plaats: locatie1.plaats,
        land: locatie1.land,
        portbase_code: locatie1.portbase_code,
        bicsCode: locatie1.bicsCode
      },
      {
        volgorde: '0',
        actie: 'Laden',
        naam: klantNaam,
        adres: klantAdres,
        postcode: klantPostcode,
        plaats: klantPlaats,
        land: 'NL'
      },
      {
        volgorde: '0',
        actie: 'Afzetten',
        naam: locatie3.naam,
        adres: locatie3.adres,
        postcode: locatie3.postcode,
        plaats: locatie3.plaats,
        land: locatie3.land,
        portbase_code: locatie3.portbase_code,
        bicsCode: locatie3.bicsCode
      }
    ]
  };

    let laadDatum = '';
    let laadTijd = '';
    let bijzonderheid = '';

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
    const referentie = logResult('referentie', regels.find(r => r.startsWith('Lossen'))?.split(' ')[1]);
    
    // Tijd en datum
    const tijdMatch = regels.find(r => r.match(/\d{2}:\d{2}/))?.match(/(\d{2}):(\d{2})/);
    const tijd = tijdMatch ? `${tijdMatch[1]}:${tijdMatch[2]}:00` : '';
    const dateMatch = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/);
    logResult('tijd', tijd);

    if (dateMatch) {
      const dag = parseInt(dateMatch[1]).toString().padStart(2, '0');
      const maandStr = dateMatch[2].toLowerCase().slice(0, 3);
      const jaar = dateMatch[3];
      const tijdUitDateMatch = dateMatch[4];
      const maanden = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
      const maand = (maanden[maandStr] || 0).toString().padStart(2, '0');
      
      laadDatum = `${dag}-${maand}-${jaar}`;
      laadTijd = tijdUitDateMatch ? `${tijdUitDateMatch}:00` : '';
    } else {
      const nu = new Date();
      laadDatum = `${nu.getDate().toString().padStart(2, '0')}-${(nu.getMonth() + 1).toString().padStart(2, '0')}-${nu.getFullYear()}`;
      laadTijd = '';
      bijzonderheid = 'DATUM STAAT VERKEERD';
    }
    
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

    const containerData = {
      containernummer,
      containertype: containertypeRaw,
      containertypeCode,
      volume,
      colli,
      geladenGewicht: gewicht,
      brutogewicht: gewicht,
      zegel,
      referentie,
      datum: laadDatum,
      tijd: laadTijd,
      instructies: bijzonderheid,
      laadreferentie: '',
      lading,
      adr,
      tarra: '0',
      temperatuur: logResult('temperatuur', regels.find(r => r.includes('°C'))?.match(/(\d{1,2})/)?.[1] || ''),
      brix: '0',
      documentatie: '',
      tar: '',
      inleverreferentie: referentie,
      inleverBestemming: '',
      instructies,
      ladenOfLossen: ''
    };

    containers.push(containerData);
  }

  return { containers, algemeneData };
}