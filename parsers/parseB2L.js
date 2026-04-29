// parsers/parseB2L.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getAdresboekEntry,
  getContainerTypeCode,
  getRederijNaam,
  getKlantData,
  normLand,
  cleanFloat
} from '../utils/lookups/terminalLookup.js';

const MONTHS_EN = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function parseDatumNL(str) {
  const m = (str || '').match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (!m) return '';
  return `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}-${m[3]}`;
}

function parseDatumEN(str) {
  // "22-Apr-2026" or "29-APR-2026"
  const m = (str || '').match(/(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})/);
  if (!m) return '';
  const maand = MONTHS_EN[m[2].toLowerCase()];
  if (!maand) return '';
  return `${m[1].padStart(2,'0')}-${String(maand).padStart(2,'0')}-${m[3]}`;
}

function valAfterLabel(line, label) {
  return line?.replace(new RegExp(`.*${label}[:\\s]*`, 'i'), '').trim() || '';
}

export default async function parseB2L(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { text } = await pdfParse(buffer);
  // Deduplicate lines (PDF has 3 identical page headers)
  const seen = new Set();
  const ls = text.split('\n')
    .map(r => r.trim())
    .filter(r => r && !seen.has(r) && seen.add(r));
  console.log('📋 B2L regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // === Referentie / ritnummer ===
  const refIdx  = ls.findIndex(l => /^REFERENTIE$/i.test(l));
  const ritnummer = refIdx >= 0 ? (ls[refIdx + 1] || '') : '';

  // === Datum (voorkeur: laaddatum uit schedule, fallback: documentdatum) ===
  const docDatum = ls.find(l => /^\d{2}-\d{2}-\d{4}$/.test(l)) || '';

  // Loading schedule dates
  const schedLine = ls.find(l => /40ft High Cube/i.test(l));
  const loadDatumEN = schedLine?.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/)?.[1] || '';
  const datum = parseDatumEN(loadDatumEN) || parseDatumNL(docDatum);

  // Load times from schedule
  const tijden = ls
    .filter(l => /at\s+\d{2}[:.]\d{2}h?/i.test(l))
    .map(l => l.match(/(\d{2})[.:.](\d{2})/)?.[0]?.replace('.', ':') + ':00' || '');

  // === Container type ===
  const containerSetLine = ls.find(l => /CONTAINER SET/i.test(l));
  const countMatch = containerSetLine?.match(/(\d+)X\s+(.+)/i);
  const containerCount = parseInt(countMatch?.[1] || '1');
  const containertypeRaw = countMatch?.[2]?.trim() || '40FT HIGH CUBE';
  const containertype = /high.?cube|HC/i.test(containertypeRaw)
    ? (/40/i.test(containertypeRaw) ? '40ft HC' : '45ft HC')
    : (/40/i.test(containertypeRaw) ? '40ft' : '20ft');

  // === Cargo ===
  const cargoLine  = ls.find(l => /CARGO DESCRIPTION/i.test(l));
  const weightLine = ls.find(l => /ESTIMATED WEIGHT/i.test(l));
  const lading  = valAfterLabel(cargoLine,  'CARGO DESCRIPTION');
  const kgMatch = weightLine?.match(/([\d.,]+)\s*KGS?/i);
  const gewicht = kgMatch ? String(Math.round(parseFloat(kgMatch[1].replace(',', '.')))) : '0';

  // === Detecteer formaat: export (PLACE OF LOADING) vs import (PLACE OF DELIVERY/UNLOADING) ===
  const isImport = !ls.some(l => /PLACE OF LOADING/i.test(l)) &&
                   ls.some(l => /PLACE OF (DELIVERY|UNLOADING|DISCHARGE)|DELIVERY ADDRESS/i.test(l));
  console.log(`🔀 B2L formaat: ${isImport ? 'IMPORT (lossen)' : 'EXPORT (laden)'}`);

  // === Referenties ===
  // Export: EMPTY PICK-UP TERMINAL | Import: FULL PICK-UP TERMINAL
  const epuIdx = ls.findIndex(l => /EMPTY PICK-UP TERMINAL|FULL PICK-UP TERMINAL|PICK-?UP TERMINAL/i.test(l));
  const referentie = epuIdx >= 0
    ? (ls[epuIdx + 1] || '').replace(/.*REFERENCE[:\s]*/i, '').trim()
    : '';

  // === Rederij & Bootnaam ===
  const voyageLine = ls.find(l => /CARRIER.*MAIN VESSEL|MAIN VESSEL.*CARRIER/i.test(l));
  const rederijRaw  = voyageLine?.match(/CARRIER[:\s]+(.+?)(?=MAIN VESSEL)/i)?.[1]?.trim() || '';
  const bootnaam    = voyageLine?.match(/MAIN VESSEL[:\s]+(.+)/i)?.[1]?.trim() || '';
  const etsLine     = ls.find(l => /ETS[:\s]/i.test(l));
  const etsRaw      = etsLine?.match(/ETS[:\s]*(\d{1,2}-[A-Za-z]{3}-\d{4})/i)?.[1] || '';
  const etsDatum    = parseDatumEN(etsRaw);

  // === Locaties — export vs import ===
  let opzettenNaam = '', opzettenAdres = '', opzettenAdresPCPlaats = '';
  let klantNaam = '', klantAdres = '', klantPCPlaats = '', klantLand = '';
  let laadActie = 'Laden';
  let afzettenNaam = '', afzettenAdres = '', afzettenPCPlaats = '';

  // Helper: sla sectielabels over en geef de eerste 'echte' bedrijfsnaam terug
  // (B2L PDFs hebben soms "FULL PICK-UP TERMINAL" als sub-header na een sectielabel)
  const SECTION_LABELS = /^(FULL|EMPTY)\s+(PICK-?UP|DELIVERY|RETURN)\s+TERMINAL|^PLACE\s+OF\s+(LOADING|DELIVERY|UNLOADING|DISCHARGE)|^DELIVERY\s+ADDRESS|^EMPTY\s+DEPOT/i;
  function nextRealLine(arr, startIdx) {
    for (let i = startIdx; i < arr.length; i++) {
      const line = (arr[i] || '').replace(/REFERENCE[:\s].*/i, '').trim();
      if (line && !SECTION_LABELS.test(line)) return { line, idx: i };
    }
    return { line: '', idx: startIdx };
  }

  if (!isImport) {
    // ── Export: Opzetten=lege pickup, Laden=klant, Afzetten=volle aflevering ──
    const { line: epuLine, idx: epuNameIdx } = nextRealLine(ls, epuIdx + 1);
    opzettenNaam  = epuLine;
    opzettenAdres = ls[epuNameIdx + 1] || '';

    const polIdx = ls.findIndex(l => /PLACE OF LOADING/i.test(l));
    if (polIdx >= 0) {
      const { line: polLine, idx: polNameIdx } = nextRealLine(ls, polIdx + 1);
      klantNaam     = polLine;
      klantAdres    = ls[polNameIdx + 1] || '';
      klantPCPlaats = ls[polNameIdx + 2] || '';
      klantLand     = ls[polNameIdx + 3] || '';
    }
    laadActie = 'Laden';

    const fdtIdx = ls.findIndex(l => /FULL DELIVERY TERMINAL/i.test(l));
    if (fdtIdx >= 0) {
      const { line: fdtLine, idx: fdtNameIdx } = nextRealLine(ls, fdtIdx + 1);
      afzettenNaam     = fdtLine;
      afzettenAdres    = ls[fdtNameIdx + 1] || '';
      afzettenPCPlaats = ls[fdtNameIdx + 2] || '';
    }
  } else {
    // ── Import: Opzetten=volle pickup terminal, Lossen=klant, Afzetten=lege return ──
    const { line: fpuLine, idx: fpuNameIdx } = nextRealLine(ls, epuIdx + 1);
    opzettenNaam  = fpuLine;
    opzettenAdres = ls[fpuNameIdx + 1] || '';

    const podIdx = ls.findIndex(l => /PLACE OF (DELIVERY|UNLOADING|DISCHARGE)|DELIVERY ADDRESS/i.test(l));
    if (podIdx >= 0) {
      const { line: podLine, idx: podNameIdx } = nextRealLine(ls, podIdx + 1);
      klantNaam     = podLine;
      klantAdres    = ls[podNameIdx + 1] || '';
      klantPCPlaats = ls[podNameIdx + 2] || '';
      klantLand     = ls[podNameIdx + 3] || '';
    }
    laadActie = 'Lossen';

    const erdIdx = ls.findIndex(l => /EMPTY (RETURN|DELIVERY) TERMINAL|EMPTY DEPOT/i.test(l));
    if (erdIdx >= 0) {
      const { line: erdLine, idx: erdNameIdx } = nextRealLine(ls, erdIdx + 1);
      afzettenNaam     = erdLine;
      afzettenAdres    = ls[erdNameIdx + 1] || '';
      afzettenPCPlaats = ls[erdNameIdx + 2] || '';
    }
  }

  // Container nummer uit PDF tekst (bijv. HLBU3904412 of BSIU3317531)
  const containerNummerPDF = ls.find(l => /[A-Z]{4}\d{7}/.test(l))
    ?.match(/([A-Z]{4}\d{7})/)?.[1] || '';

  // Parse postcode + plaats uit "6541 CS NIJMEGEN"
  const pcMatch   = klantPCPlaats.match(/^(\d{4}\s?[A-Z]{2})\s+(.+)/i);
  const klantPC   = pcMatch?.[1]?.replace(/(\d{4})([A-Z]{2})/, '$1 $2') || klantPCPlaats;
  const klantPlaats = pcMatch?.[2] || '';

  // Terminal lookups
  const [opzettenInfo, afzettenInfo, klant, klantInfo] = await Promise.all([
    getTerminalInfoMetFallback(opzettenNaam),
    getTerminalInfoMetFallback(afzettenNaam),
    getKlantData('b2l cargocare'),
    getAdresboekEntry(klantNaam, null, klantAdres)
  ]);
  const ctCode      = await getContainerTypeCode(containertype);
  // Rederij MOET uit de lijst komen — nooit raw doorsturen
  const rederijNaam = await getRederijNaam(rederijRaw.split(' ')[0]) || '';

  const instructies = ls
    .slice(ls.findIndex(l => /SPECIAL INSTRUCTIONS/i.test(l)) + 1,
           ls.findIndex(l => /GENERAL INFORMATION/i.test(l)))
    .filter(Boolean)
    .join(' ')
    .slice(0, 300);

  // === Bouw resultaat per container ===
  const results = [];
  for (let i = 0; i < containerCount; i++) {
    const tijd = tijden[i] || '';

    const locaties = [
      {
        volgorde: '0', actie: 'Opzetten',
        naam:     opzettenInfo?.naam     || opzettenNaam,
        adres:    opzettenInfo?.adres    || opzettenAdres,
        postcode: opzettenInfo?.postcode || '',
        plaats:   opzettenInfo?.plaats   || '',
        land:     normLand(opzettenInfo?.land || 'NL'),
        voorgemeld: opzettenInfo?.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
        aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
        portbase_code: cleanFloat(opzettenInfo?.portbase_code || ''),
        bicsCode:      cleanFloat(opzettenInfo?.bicsCode      || '')
      },
      {
        volgorde: '0', actie: laadActie,
        naam:     klantInfo?.naam     || klantNaam,
        adres:    klantInfo?.adres    || klantAdres,
        postcode: klantInfo?.postcode || klantPC,
        plaats:   klantInfo?.plaats   || klantPlaats,
        land:     klantLand === 'NETHERLANDS' ? 'NL' : (klantLand || 'NL')
      },
      {
        volgorde: '0', actie: 'Afzetten',
        naam:     afzettenInfo?.naam     || afzettenNaam,
        adres:    afzettenInfo?.adres    || afzettenAdres,
        postcode: afzettenInfo?.postcode || afzettenPCPlaats.match(/\d{4}\s?[A-Z]{2}/i)?.[0] || '',
        plaats:   afzettenInfo?.plaats   || afzettenPCPlaats.replace(/^\d{4}\s?[A-Z]{2},?\s*/i, '').split(',')[0].trim(),
        land:     normLand(afzettenInfo?.land || 'NL'),
        voorgemeld: afzettenInfo?.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
        aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
        portbase_code: cleanFloat(afzettenInfo?.portbase_code || ''),
        bicsCode:      cleanFloat(afzettenInfo?.bicsCode      || '')
      }
    ];

    results.push({
      ritnummer,
      klantnaam:    klantInfo?.naam     || klantNaam,
      klantadres:   klantInfo?.adres    || klantAdres,
      klantpostcode: klantInfo?.postcode || klantPC,
      klantplaats:  klantInfo?.plaats   || klantPlaats,

      opdrachtgeverNaam:     klant.naam     || 'B2L CARGOCARE',
      opdrachtgeverAdres:    klant.adres    || '',
      opdrachtgeverPostcode: klant.postcode || '',
      opdrachtgeverPlaats:   klant.plaats   || '',
      opdrachtgeverTelefoon: klant.telefoon || '',
      opdrachtgeverEmail:    klant.email    || '',
      opdrachtgeverBTW:      klant.btw      || '',
      opdrachtgeverKVK:      klant.kvk      || '57',

      containernummer: containerNummerPDF || '',
      containertype,
      containertypeCode: ctCode || '0',

      datum,
      tijd,
      referentie,
      laadreferentie:    referentie,
      inleverreferentie: referentie,
      inleverBestemming: '',

      rederij:        rederijNaam,
      bootnaam,
      inleverRederij: rederijNaam,
      inleverBootnaam: bootnaam,

      zegel: '',
      colli: '0',
      lading,
      brutogewicht:   gewicht,
      geladenGewicht: gewicht,
      cbm: '0',

      adr: 'Onwaar',
      ladenOfLossen: isImport ? 'Lossen' : 'Laden',
      instructies,
      tar: '', documentatie: '', tarra: '0', brix: '0',

      locaties
    });
  }

  console.log(`✅ parseB2L: ${results.length} container(s)`);
  return results;
}
