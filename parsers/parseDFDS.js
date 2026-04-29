// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import PDFParser from 'pdf2json';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode,
  normLand,
  cleanFloat
} from '../utils/lookups/terminalLookup.js';

function extractLinesPdf2Json(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    pdfParser.on('pdfParser_dataError', err => reject(err.parserError));
    pdfParser.on('pdfParser_dataReady', pdf => {
      const linesMap = new Map();
      for (const page of pdf.Pages) {
        for (const item of page.Texts) {
          const text = decodeURIComponent(item.R[0].T).trim();
          const y = item.y.toFixed(2);
          if (!linesMap.has(y)) linesMap.set(y, []);
          linesMap.get(y).push(text);
        }
      }
      const sorted = [...linesMap.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
      resolve(sorted.map(([_, woorden]) => woorden.join(' ').trim()));
    });
    pdfParser.parseBuffer(buffer);
  });
}

function log(label, val) {
  console.log(`🔍 ${label}:`, val || '[LEEG]');
  return val;
}

function formatTijd(t) {
  const m = t?.match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}:00` : '';
}

// Splits "EUROPAWEG 875 , 3199 LD Maasvlakte / Rotterdam, THE NETHERLANDS" into adres/postcode/plaats
function parseAdresRegel(r) {
  if (!r) return { adres: '', postcode: '', plaats: '' };
  const cleaned = r.replace(/,?\s*THE NETHERLANDS.*$/i, '').trim();
  const m = cleaned.match(/^(.+?)\s*,?\s*(\d{4}\s*[A-Z]{2})\s+(.+)$/i);
  if (m) {
    return {
      adres: m[1].replace(/\s*,\s*$/, '').trim(),
      postcode: m[2].trim(),
      plaats: m[3].replace(/\s*\/.*$/, '').trim()
    };
  }
  return { adres: cleaned, postcode: '', plaats: '' };
}

export default async function parseDFDS(buffer) {
  const regels = await extractLinesPdf2Json(buffer);
  console.log('📋 DFDS regels:\n', regels.map((r, i) => `[${i}] ${r}`).join('\n'));

  // === Gedeelde orderdata ===
  const datumRegel  = regels.find(r => /\bDatum\s+\d{2}-\d{2}-\d{4}\b/.test(r));
  const orderDatum  = datumRegel?.match(/(\d{2}-\d{2}-\d{4})/)?.[1] || '';
  const ritnummer   = log('ritnummer', regels.find(r => r.includes('Onze referentie'))?.match(/SFIM\d{7}/)?.[0] || '');
  const bootnaam    = log('bootnaam',  regels.find(r => r.includes('Vaartuig'))?.split('Vaartuig')[1]?.split('Reis')[0]?.trim() || '');
  const rederijRaw  = regels.find(r => r.includes('Rederij'))?.split('Rederij')[1]?.trim() || '';
  const rederij     = log('rederij',   rederijRaw.replace(/\s+[A-Z]{3}[UJZ]\d{7}.*$/i, '').trim());

  // Klantnaam: eerste woord(en) voor " Datum " op de datumregel
  const klantnaam   = log('klantnaam',  datumRegel?.match(/^(.+?)\s+Datum\s+\d{2}-\d{2}-\d{4}/)?.[1]?.trim() || '');
  // Klantadres: alles voor "Onze referentie" op die regel
  const refRegel    = regels.find(r => r.includes('Onze referentie'));
  const klantadres  = refRegel?.split('Onze referentie')[0]?.trim() || '';
  // Postcode + plaats
  const plaatsRegel = regels.find(r => /^\d{4}\s+[A-Za-z]{2}\s+\S/.test(r));
  const klantpostcode = plaatsRegel?.match(/^(\d{4}\s*[A-Za-z]{2})/)?.[1]?.replace(/\s+/, ' ').trim() || '';
  const klantplaats   = plaatsRegel?.match(/^\d{4}\s+[A-Za-z]{2}\s+(.+)/)?.[1]?.trim() || '';

  const adr = /ADR/i.test(regels.join(' ')) ? 'Waar' : 'Onwaar';

  // === Goederen informatie: container# → {zegel, colli, lading, gewicht, cbm} ===
  // Lijn: "MEDU2842649 20ft - 33,2 m ³ / Zegel: 236199"
  // Volgende lijn: "10 BAG CON SIERRITA LS HB 4000 LB NT BB (UL) EU 18.338,73 kg 0 m3"
  const goederenMap = new Map();
  for (let i = 0; i < regels.length; i++) {
    const zm = regels[i].match(/([A-Z]{3}U\d{7})\s+.+\/\s*Zegel:\s*(\S+)/i);
    if (!zm) continue;
    const cntr  = zm[1];
    const zegel = zm[2].replace(/[,.]$/, '');
    // Zoek cargo-lijn: eerstvolgende lijn met kg binnen 5 stappen
    let cargo = '';
    for (let j = 1; j <= 5; j++) {
      const candidate = regels[i + j] || '';
      if (/\d+\s*kg/i.test(candidate)) {
        cargo = candidate;
        break;
      }
      console.log(`📦 Kandidaat [i+${j}] voor ${zm[1]}: "${candidate}"`);
    }
    console.log(`📦 Cargo-lijn voor ${zm[1]}: "${cargo}"`);
    const colli = cargo.match(/(\d+)\s+(?:BAG|CTN|PLT|PKG|BOX|BALE|DRUM|COIL|PCE|PCS|STK|ROL)/i)?.[1]
                || cargo.match(/^(\d+)/)?.[1] || '0';
    // Gewicht: Europees formaat – verwijder punten (duizendtal), vervang komma door punt
    const gm = cargo.match(/([\d.]+,\d+)\s*kg/i) || cargo.match(/([\d]+(?:[.,]\d+)?)\s*kg/i);
    const rawGewicht = gm?.[1] || '';
    const gewichtFloat = rawGewicht ? parseFloat(rawGewicht.replace(/\./g, '').replace(',', '.')) : 0;
    const gewicht = gewichtFloat > 0 ? String(Math.round(gewichtFloat)) : '0';
    const cbm     = cargo.match(/([\d.,]+)\s*m3/i)?.[1]?.replace(',', '.') || '0';
    // lading: alles tussen de eenheid (BAG/CTN/…) en het gewicht, ongeacht formaat (punt of komma decimalen)
    const ladM    = cargo.match(/^\d+\s+\w+\s+(.+?)\s+[\d.,]+\s*kg/i);
    const lading  = (ladM?.[1]?.trim() || '').toUpperCase();
    goederenMap.set(cntr, { zegel, colli, lading, gewicht, cbm });
    console.log(`📦 Goederen [${cntr}]: zegel=${zegel} | colli=${colli} | gewicht=${gewicht} | cbm=${cbm} | lading="${lading}" | rawGewicht="${rawGewicht}"`);
  }

  // === Transport tabel: per-container blokken ===
  // Header: "Container Maat / soort Soort Referentie Datum / Tijd"
  // Daarna per container 3 regels:
  //   [CNTR] 20ft - 33,2 m³ Pickup PORTBASE [date]
  //   Lossen [booking_ref] [date] [tijd]
  //   Dropoff [dropoff_ref] [date]
  const tableHdrIdx = regels.findIndex(r => r.includes('Container') && r.includes('Maat') && r.includes('Referentie'));
  const containerBlokken = [];
  let i = tableHdrIdx + 1;
  while (i < regels.length) {
    const r = regels[i];
    if (/^[A-Z]{3}U\d{7}\s+.+Pickup/i.test(r)) {
      const cntr     = r.match(/([A-Z]{3}U\d{7})/i)?.[1] || '';
      const typeM    = r.match(/[A-Z]{3}U\d{7}\s+(.+?)\s+-\s+([\d.,]+)\s*m/i);
      const pickupDt = r.match(/(\d{2}-\d{2}-\d{4})/)?.[1] || '';
      const pickupRef = r.match(/Pickup\s+(\S+)\s+\d{2}-\d{2}-\d{4}/i)?.[1] || '';
      const lossenR  = regels[i + 1] || '';
      const dropoffR = regels[i + 2] || '';
      // Tijd is optioneel – sommige DFDS regels hebben geen tijdslot
      const lossenM  = lossenR.match(/^Lossen\s+(\S+)\s+(\d{2}-\d{2}-\d{4})(?:\s+(\d{2}:\d{2}))?/i);
      const dropRef  = dropoffR.match(/^Dropoff\s+(\S+)/i)?.[1] || '';
      console.log(`🚛 [${cntr}] lossenRegel: "${lossenR}" → ref=${lossenM?.[1]||'—'} datum=${lossenM?.[2]||'—'} tijd=${lossenM?.[3]||'—'}`);
      containerBlokken.push({
        containernummer: cntr,
        containertype:   typeM?.[1]?.trim() || '',
        cbmTransport:    typeM?.[2]?.replace(',', '.') || '0',
        pickupDatum:     pickupDt,
        pickupRef,
        lossenRef:       lossenM?.[1] || '',
        datum:           lossenM?.[2] || pickupDt || orderDatum,
        tijd:            formatTijd(lossenM?.[3] || ''),
        dropoffRef:      dropRef
      });
      i += 3;
    } else if (r.startsWith('Pickup ') && !r.includes('PORTBASE')) {
      break; // locatiesectie begint
    } else {
      i++;
    }
  }
  console.log(`📦 ${containerBlokken.length} container(s) in transport tabel`);

  // === Locaties: aparte sectie na de transport tabel ===
  // "Pickup Ect Delta Terminal" / "Lossen Climax" / "Dropoff Ect Delta Terminal"
  // Zoek ALLEEN in de locatiesectie (na de transport-tabel) zodat referentienummers
  // zoals "Dropoff 610RT4S87694" (in de container-tabel) niet worden meegenomen.
  const locSectie = regels.slice(i); // i staat nu op de eerste locatieregel

  const pickupLocR  = locSectie.find(r => r.startsWith('Pickup '));
  const lossenLocR  = locSectie.find(r => r.startsWith('Lossen '));
  const dropoffLocR = locSectie.find(r => r.startsWith('Dropoff '));

  const pickupLocNaam  = pickupLocR?.replace('Pickup ', '').trim()  || '';
  const lossenLocNaam  = lossenLocR?.replace('Lossen ', '').trim()  || '';
  const dropoffLocNaam = dropoffLocR?.replace('Dropoff ', '').trim() || '';

  // Adresregel staat direct na de locatieregel in dezelfde sectie
  const locOffset = (locR) => {
    const idx = locSectie.findIndex(r => r === locR);
    return idx >= 0 ? locSectie[idx + 1] || '' : '';
  };
  const pickupLocAdres  = locOffset(pickupLocR);
  const lossenLocAdres  = locOffset(lossenLocR);
  const dropoffLocAdres = locOffset(dropoffLocR);

  console.log('📍 Opzetten:', pickupLocNaam, '|', pickupLocAdres);
  console.log('📍 Lossen:',  lossenLocNaam,  '|', lossenLocAdres);
  console.log('📍 Afzetten:', dropoffLocNaam, '|', dropoffLocAdres);

  const [pickupInfo, lossenInfo, dropoffInfo] = await Promise.all([
    getTerminalInfoMetFallback(pickupLocNaam),
    getTerminalInfoMetFallback(lossenLocNaam),
    getTerminalInfoMetFallback(dropoffLocNaam)
  ]);

  const pA = parseAdresRegel(pickupLocAdres);
  const lA = parseAdresRegel(lossenLocAdres);
  const dA = parseAdresRegel(dropoffLocAdres);

  const locaties = [
    {
      volgorde: '0', actie: 'Opzetten',
      naam:     pickupInfo?.naam     || pickupLocNaam,
      adres:    pickupInfo?.adres    || pA.adres,
      postcode: pickupInfo?.postcode || pA.postcode,
      plaats:   pickupInfo?.plaats   || pA.plaats,
      land:     normLand(pickupInfo?.land || 'NL'),
      voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(pickupInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(pickupInfo?.bicsCode      || '')
    },
    {
      volgorde: '0', actie: 'Lossen',
      naam:     lossenInfo?.naam     || lossenLocNaam,
      adres:    lossenInfo?.adres    || lA.adres,
      postcode: lossenInfo?.postcode || lA.postcode,
      plaats:   lossenInfo?.plaats   || lA.plaats,
      land:     normLand(lossenInfo?.land || 'NL'),
      portbase_code: cleanFloat(lossenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(lossenInfo?.bicsCode      || '')
    },
    {
      volgorde: '0', actie: 'Afzetten',
      naam:     dropoffInfo?.naam     || dropoffLocNaam,
      adres:    dropoffInfo?.adres    || dA.adres,
      postcode: dropoffInfo?.postcode || dA.postcode,
      plaats:   dropoffInfo?.plaats   || dA.plaats,
      land:     normLand(dropoffInfo?.land || 'NL'),
      voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(dropoffInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(dropoffInfo?.bicsCode      || '')
    }
  ];

  // === Bouw resultaat per container ===
  const base = {
    opdrachtgeverNaam:      'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
    opdrachtgeverAdres:     'WOLGAWEG 3',
    opdrachtgeverPostcode:  '3198 LR',
    opdrachtgeverPlaats:    'ROTTERDAM',
    opdrachtgeverTelefoon:  '010-1234567',
    opdrachtgeverEmail:     'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW:       'NL007129099B01',
    opdrachtgeverKVK:       '24232781',
    ritnummer, bootnaam, rederij,
    inleverBootnaam: bootnaam,
    inleverRederij:  rederij,
    klantnaam, klantadres, klantpostcode, klantplaats,
    adr,
    ladenOfLossen:    'Lossen',
    instructies:      '',
    tar:              '',
    documentatie:     '',
    inleverBestemming:'',
    tarra:            '0',
    brix:             '0',
    referentie:       '',
    locaties
  };

  if (containerBlokken.length === 0) {
    console.warn('⚠️ Geen containers gevonden in transport tabel');
    return [{ ...base, containertype: '', containernummer: '', datum: orderDatum }];
  }

  const results = await Promise.all(containerBlokken.map(async blok => {
    const g    = goederenMap.get(blok.containernummer) || {};
    const ctCode = await getContainerTypeCode(blok.containertype) || '0';
    return {
      ...base,
      containernummer:        blok.containernummer,
      containertype:          blok.containertype,
      containertypeCode:      ctCode,
      cbm:                    g.cbm  || blok.cbmTransport,
      zegel:                  g.zegel || '',
      colli:                  g.colli || '0',
      lading:                 (g.lading || '').toUpperCase(),
      brutogewicht:           g.gewicht || '0',
      geladenGewicht:         g.gewicht || '0',
      referentie:             blok.pickupRef,
      datum:                  blok.datum,
      tijd:                   blok.tijd,
      laadreferentie:         blok.lossenRef,
      inleverreferentie:      blok.dropoffRef
    };
  }));

  console.log(`✅ ${results.length} DFDS container(s) geparsed`);
  return results;
}
