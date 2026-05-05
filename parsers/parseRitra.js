// parsers/parseRitra.js
import '../utils/fsPatch.js';
import { extractPdfText } from '../utils/ocrPdf.js';
import { normLand } from '../utils/lookups/terminalLookup.js';
import { enrichOrder } from '../utils/enrichOrder.js';

function parseDatum(str) {
  const m = (str || '').match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${parseInt(m[1])}-${parseInt(m[2])}-${yyyy}`;
}

function splitPCPlaats(raw) {
  // "3089 KMROTTERDAM" → { postcode: "3089 KM", plaats: "ROTTERDAM" }
  const m = (raw || '').match(/^(\d{4})\s*([A-Z]{2})\s*(.+)$/i);
  if (m) return { postcode: `${m[1]} ${m[2]}`, plaats: m[3] };
  return { postcode: '', plaats: raw || '' };
}

export default async function parseRitra(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { lines: ls } = await extractPdfText(buffer, 'Ritra transportopdracht');
  console.log('📋 Ritra regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // === Ritnummer ===
  const ritnummer = ls.find(l => /Opdracht nr/i.test(l))?.match(/(\d{5,})/)?.[1] || '';

  // === Datum — voorkeur: Leverdatum uit afhaaladres sectie ===
  // In Ritra PDFs staan waarden VOOR hun label (omgekeerde volgorde)
  const leverdatumIdx = ls.findIndex(l => /^Leverdatum$/i.test(l));
  let leverdatum = '';
  if (leverdatumIdx > 0) {
    for (let i = leverdatumIdx - 1; i >= Math.max(0, leverdatumIdx - 4); i--) {
      const d = parseDatum(ls[i] || '');
      if (d) { leverdatum = d; break; }
    }
  }
  // Neelevat-stijl: "Datum / tijd:" label, waarde op volgende regel
  const datumTijdIdx = ls.findIndex(l => /^Datum\s*\/\s*tijd\s*:?\s*$/i.test(l));
  const datumTijd = datumTijdIdx >= 0 ? parseDatum(ls[datumTijdIdx + 1] || '') : '';
  const etaLine    = ls.find(l => /^\d{2}\/\d{2}\/\d{2}$/.test(l));
  const docDatLine = ls.find(l => /:\d{2}\/\d{2}\/\d{4}/.test(l));
  // leverdatumNaAfhaal wordt later ingevuld (na afhaaladres-sectie); gebruik als primaire bron
  // Fallback: leverdatum (eerste hit in doc), datumTijd, etaLine, docDatLine
  const datumFallback = leverdatum || datumTijd || parseDatum(etaLine) || parseDatum((docDatLine || '').replace(':', ''));

  // === Container ===
  // Containernummer: altijd 3 letters + U + 7 cijfers (bijv. FBLU1234567)
  const cntrLine        = ls.find(l => /[A-Z]{3}U\d{7}/i.test(l));
  const containernummer = cntrLine?.match(/([A-Z]{3}U\d{7})/i)?.[1]?.toUpperCase() || '';
  const isHC           = /\bHC\b/.test(cntrLine || '');
  const typeLine       = ls.find(l => /\bft\d{2}\b/i.test(l));
  const sizeNum        = typeLine?.match(/ft(\d{2})|(\d{2})ft/i);
  const size           = sizeNum?.[1] || sizeNum?.[2] || '20';
  const containertype  = size === '40' ? (isHC ? '40ft HC' : '40ft') : `${size}ft`;

  // === Zegel ===
  // Seal kan alfanumeriek zijn (bijv. "HLK1459712"), niet alleen cijfers
  const zegel = ls.find(l => /sealnummer/i.test(l))?.match(/sealnummer[:\s]*([A-Z0-9]+)/i)?.[1] || '';

  // === Cargo ===
  let lading = '', colli = '0', gewicht = '0', cbm = '0';
  const cargoHdrIdx = ls.findIndex(l => /KindColli|Kind.*Colli/i.test(l));
  if (cargoHdrIdx >= 0) {
    const cargoLine = ls[cargoHdrIdx + 1] || '';
    lading  = cargoLine.replace(/\d[\d,.]*.*$/, '').replace(/PACKAGES?/i, '').trim();
    const wM = cargoLine.match(/(\d+)[,.](\d{3})/);
    if (wM) gewicht = String(Math.round(parseFloat(wM[0].replace(',', '.'))));
    const col = ls[cargoHdrIdx + 2];
    const kg  = ls[cargoHdrIdx + 3];
    const cbmLine = ls[cargoHdrIdx + 4];
    if (/^\d+$/.test(col)) colli = col;
    if (/^\d+$/.test(kg) && parseInt(kg) > 100) gewicht = kg;
    const cbmM = (cbmLine || '').match(/^([\d]+)[,.]?([\d]*)/);
    if (cbmM) cbm = cbmLine.replace(/Totaal.*/i, '').replace(',', '.').trim();
  }

  // === Rederij & Bootnaam ===
  const rederijLabelIdx = ls.findIndex(l => /^Rederij$/i.test(l));
  const schipLabelIdx   = ls.findIndex(l => /^Schip$/i.test(l));

  let rederijCode = '', bootnaam = '';
  // Values appear BEFORE their labels in the merged pdf output
  if (rederijLabelIdx > 0) {
    for (let i = rederijLabelIdx - 1; i >= Math.max(0, rederijLabelIdx - 6); i--) {
      if (/^[A-Z]{3,4}$/.test(ls[i])) { rederijCode = ls[i]; break; }
    }
  }
  if (schipLabelIdx > 0) {
    for (let i = schipLabelIdx - 1; i >= Math.max(0, schipLabelIdx - 8); i--) {
      if (/^[A-Z]{3,}\s+[A-Z]{3,}$/.test(ls[i])) { bootnaam = ls[i]; break; }
    }
  }

  // === Referenties ===
  // In Ritra PDFs staan waarden VOOR hun label
  // Nota ref: "Op uw nota ons nota ref vermelden s.v.p.: 22604067 WBH"
  // Vang getal + eventuele letters erna (bijv. "22604067 WBH")
  const notaRefLijn = ls.find(l => /nota\s*ref/i.test(l)) || '';
  const notaRefM    = notaRefLijn.match(/:\s*(\d{4,}(?:\s+[A-Z]{2,5})?)/i);
  const notaRef     = notaRefM ? notaRefM[1].trim() : '';

  // Releasenummer = terminal PIN (uithaalreferentie) — waarde vóór "Releasenummer" label
  // Dit is de ophaalcode bij de terminal (opzetref)
  const releasenrIdx = ls.findIndex(l => /^Releasenummer$/i.test(l));
  let releasenr = '';
  if (releasenrIdx > 0) {
    for (let i = releasenrIdx - 1; i >= Math.max(0, releasenrIdx - 12); i--) {
      if (/^\d{6,}$/.test(ls[i])) { releasenr = ls[i]; break; }
    }
  }

  // Reisnr = reisreferentie / voyage number — waarde vóór "Reisnr" label
  // Wordt opgeslagen als laadreferentie (niet als terminal PIN)
  const reisnrIdx = ls.findIndex(l => /^Reisnr$/i.test(l));
  let reisnr = '';
  if (reisnrIdx > 0) {
    for (let i = reisnrIdx - 1; i >= Math.max(0, reisnrIdx - 5); i--) {
      // Reisnr kan alfanumeriek zijn (bijv. "FE3S" of "123456")
      if (/^[A-Z0-9]{4,}$/.test(ls[i])) { reisnr = ls[i]; break; }
    }
  }

  console.log(`🔑 Ritra refs: releasenr="${releasenr}" reisnr="${reisnr}" notaRef="${notaRef}"`);
  // Lookup voor uithaalreferentie op andere bekende labels
  const uithaalLabelIdx = ls.findIndex(l => /^(Uithaalreferentie|Uithaalref|Vrijgave|Vrijgavenr|Pinnummer|Pin\s*nr)$/i.test(l));
  let uithaalRef = '';
  if (uithaalLabelIdx > 0) {
    for (let i = uithaalLabelIdx - 1; i >= Math.max(0, uithaalLabelIdx - 5); i--) {
      if (/^[A-Z0-9]{4,}$/.test(ls[i])) { uithaalRef = ls[i]; break; }
    }
  }

  // === Locaties ===
  const afhaalIdx  = ls.findIndex(l => /^Afhaaladres$/i.test(l));
  const afleverIdx = ls.findIndex(l => /^Afleveradres$/i.test(l));

  // Opzetten: terminal/depot vóór afhaaladres
  // Breed zoekpatroon: terminalnamen hoeven geen "terminal" in de naam te hebben
  const TERMINAL_RE = /terminal|depot|matrans|kramer|kramer\s*group|rst\b|ect\b|rwg\b|euromax|apm\b|uwt\b|uwc\b|medrepair|cetem/i;
  let opzettenNaam = '', opzettenAdres = '', opzettenPCRaw = '';
  for (let i = Math.max(0, afhaalIdx - 12); i < afhaalIdx; i++) {
    if (TERMINAL_RE.test(ls[i]) && ls[i].length > 3) {
      opzettenNaam  = ls[i];
      opzettenAdres = ls[i + 1] || '';
      opzettenPCRaw = ls[i + 2] || '';
      break;
    }
  }
  const pcData = splitPCPlaats(opzettenPCRaw);

  // Klant (laden) ─ afhaaladres
  let klantNaam = '', klantAdres = '', klantPC = '', klantLand = '', klantPlaats = '';
  if (afhaalIdx >= 0) {
    const klantLines = [];
    for (let i = afhaalIdx + 1; i < Math.min(afhaalIdx + 10, ls.length); i++) {
      if (ls[i] !== ':' && !/^(Leverdatum|Afleveradres)$/i.test(ls[i])) klantLines.push(ls[i]);
      if (/^(Leverdatum|Afleveradres)$/i.test(ls[i])) break;
    }
    [klantNaam, klantAdres, klantPC, klantLand, klantPlaats] = klantLines;
  }

  // Leverdatum: specifiek in/na de afhaaladres-sectie zoeken (voorkomt match op depot-datum)
  // In Ritra PDFs staat de waarde VOOR het label; datum en tijd kunnen op APARTE regels staan:
  //   [ldIdx-3] "10:00"  ← tijd op eigen regel
  //   [ldIdx-2] "04/05/2026"  ← datum
  //   [ldIdx-1] (iets tussenin)
  //   [ldIdx]   "Leverdatum"
  let leverdatumNaAfhaal = '';
  let ritra_tijd = '';
  if (afhaalIdx >= 0) {
    const ldIdx = ls.findIndex((l, i) => i > afhaalIdx && /^Leverdatum$/i.test(l));
    if (ldIdx > 0) {
      for (let i = ldIdx - 1; i >= Math.max(0, ldIdx - 6); i--) {
        const line = ls[i] || '';
        const d = parseDatum(line);
        if (d) {
          leverdatumNaAfhaal = d;
          // Zoek tijd op dezelfde regel, de regel erna (richting label) en de regel ervoor
          // Formaten: "om 07:00 uur"  OF  "om 0700 uur"  OF  "07:00"
          const kandidaten = [line, ls[i + 1] || '', ls[i - 1] || ''];
          for (const cl of kandidaten) {
            // "om 0700 uur" of "om 07:00 uur"
            const omM = cl.match(/\bom\s+(\d{2})(\d{2})\s*uur\b/i)
                     || cl.match(/\bom\s+(\d{1,2}):(\d{2})/i);
            if (omM) {
              ritra_tijd = `${omM[1].padStart(2, '0')}:${omM[2]}:00`;
              break;
            }
            // Losse HH:MM
            const tijdM = cl.match(/\b(\d{1,2}):(\d{2})\b/);
            if (tijdM) {
              ritra_tijd = `${tijdM[1].padStart(2, '0')}:${tijdM[2]}:00`;
              break;
            }
          }
          console.log(`📅 Ritra leverdatum="${leverdatumNaAfhaal}" tijd="${ritra_tijd}" (regel [${i}]: "${line}")`);
          break;
        }
      }
    }
  }

  // === Los opmerking / instructies / gasmeten ===
  // Formaat in PDF: "TAV STEINMEIJER/GASMEETING:Losopm"
  // GASMETEN_RE: detecteert gasmeten/wegen/weeg — MOET altijd prominent in instructies verschijnen
  const GASMETEN_RE = /gasme[ae]ti?n?g?|\bweeg\b|\bwegen\b/i;
  let gasmeten = 'Onwaar';
  let losOpm   = '';
  const losOpmLine = ls.find(l => /Losopm/i.test(l));
  if (losOpmLine) {
    const content = losOpmLine.replace(/:?Losopm.*$/i, '').trim();
    if (GASMETEN_RE.test(content)) gasmeten = 'Waar';
    losOpm = content.split('/').filter(p => !GASMETEN_RE.test(p)).join(' ').trim();
  }
  // Extra check: ergens in het document gasmeten / wegen vermeld?
  if (gasmeten === 'Onwaar' && ls.some(l => GASMETEN_RE.test(l))) gasmeten = 'Waar';

  // Afzetten: terminal/depot na afleveradres — breed zoekpatroon (incl. Kramer, RCT, enz.)
  let afzettenNaam = '', afzettenAdres = '', afzettenRef = '';
  if (afleverIdx >= 0) {
    const afzetStart = afleverIdx + 1;
    const afzetEnd   = Math.min(afleverIdx + 35, ls.length);

    // Stap 1: afleverref staat bij het "Bestand" label (kan ":Bestand" zijn met voorloopdubbele punt)
    // Ritra PDFs: waarden staan VOOR hun label → primair ls[i-1] controleren
    // Fallback: waarde NA het label (ONEMT-stijl)
    for (let i = afzetStart; i < afzetEnd - 1; i++) {
      if (/^:?Bestand$/i.test(ls[i])) {
        const kandidaatVoor = i > afzetStart ? (ls[i - 1] || '').trim() : '';
        const kandidaatNa   = (ls[i + 1] || '').trim();
        // Waarde vóór label heeft voorkeur als het een numerieke code is (bijv. 39407780)
        const kandidaat = /^\d{4,}/.test(kandidaatVoor) ? kandidaatVoor : kandidaatNa;
        if (kandidaat && !/^(Afleveradres|Afhaaladres|Reisnr|Releasenummer)/i.test(kandidaat)) {
          afzettenRef = kandidaat;
          console.log(`🏷️  Ritra afzettenRef via "Bestand": "${afzettenRef}"`);
        }
        break;
      }
    }

    // Stap 2: zoek de terminalnaam
    for (let i = afzetStart; i < afzetEnd; i++) {
      if (TERMINAL_RE.test(ls[i]) && ls[i].length > 3) {
        const rawLijn = ls[i];
        // Controleer of naam-regel een ingebed adres bevat na de eerste komma
        // Patroon: "APM 2 Terminals Maasvlakte II b.v., Europaweg 910,"
        // Het adres bevat altijd een huisnummer (cijfer); naam bevat geen huisnummer
        const ingebedAdres = rawLijn.match(/^(.+?),\s*([A-Za-z][^,]+\d[^,]*),?\s*$/);
        if (ingebedAdres) {
          afzettenNaam  = ingebedAdres[1].trim();
          afzettenAdres = ingebedAdres[2].trim();
          console.log(`📍 Ritra afzetNaam/adres gesplitst: naam="${afzettenNaam}" adres="${afzettenAdres}"`);
        } else {
          afzettenNaam  = rawLijn.replace(/,\s*$/, '').trim();
          afzettenAdres = ls[i + 1] || '';
        }

        // Als ref nog niet gevonden: zoek vóór de terminalmatch voor standalone code (bijv. "ONEMT")
        if (!afzettenRef) {
          for (let j = afzetStart; j < i; j++) {
            if (/^[A-Z]{3,8}$/.test(ls[j])) { afzettenRef = ls[j].trim(); break; }
          }
        }

        // Als nog steeds niet gevonden: zoek NA de terminalmatch
        if (!afzettenRef) {
          for (let j = i + 1; j < Math.min(i + 8, ls.length); j++) {
            const refM = ls[j].match(/(?:referentie|ref\.?|reference)[:\s]+(.+)/i)
                      || ls[j].match(/^([A-Z][A-Z0-9 ]{2,}(?:\/|\\)[A-Z0-9 \/\\]+)$/i);
            if (refM) { afzettenRef = refM[1].trim(); break; }
            if (/^[A-Z]{2,}(?:\s+[A-Z0-9]+)+$/i.test(ls[j]) && ls[j].length < 40) {
              afzettenRef = ls[j].trim(); break;
            }
            if (/^[A-Z]{3,8}$/.test(ls[j])) { afzettenRef = ls[j].trim(); break; }
          }
        }
        break;
      }
    }
  }
  if (!afzettenNaam) {
    afzettenNaam = (ls.find(l => /ECT.*Terminal|Euromax/i.test(l)) || '').replace(/,.*/, '').trim();
  }
  console.log(`📍 Ritra afzetdepot: naam="${afzettenNaam}" ref="${afzettenRef}"`);

  // Ruwe locaties — enrichOrder doet alle lookups
  const locaties = [
    { volgorde: '0', actie: 'Opzetten', naam: opzettenNaam, adres: opzettenAdres, postcode: pcData.postcode, plaats: pcData.plaats, land: 'NL' },
    { volgorde: '0', actie: 'Laden',    naam: klantNaam, adres: klantAdres, postcode: klantPC, plaats: klantPlaats, land: normLand(klantLand || 'NL') },
    { volgorde: '0', actie: 'Afzetten', naam: afzettenNaam, adres: afzettenAdres, postcode: '', plaats: '', land: 'NL' }
  ];

  return [await enrichOrder({
    ritnummer,
    klantnaam:    klantNaam,
    klantadres:   klantAdres,
    klantpostcode: klantPC,
    klantplaats:  klantPlaats,

    opdrachtgeverNaam:     'RITRA',
    opdrachtgeverAdres:    'ALBERT PLESMANWEG 61C',
    opdrachtgeverPostcode: '3088 GB',
    opdrachtgeverPlaats:   'ROTTERDAM',
    opdrachtgeverTelefoon: '010-7671000',
    opdrachtgeverEmail:    'info@ritra.nl',
    opdrachtgeverBTW:      'NL007191431B01',
    opdrachtgeverKVK:      '24170187',

    containernummer,
    containertype,

    datum:             leverdatumNaAfhaal || datumFallback,
    tijd:              ritra_tijd || '',
    // Releasenummer = terminal PIN (uithaalreferentie bij opzetten)
    // Reisnr        = voyage/reisreferentie (laadreferentie)
    // afzettenRef   = inleverreferentie bij afzetten (bijv. "ONEMT")
    referentie:        uithaalRef || releasenr || notaRef,
    // notaRef altijd opnemen in laadreferentie — dit is de klant-factuurreferentie
    // die op de transportopdracht vermeld moet worden (ook als reisnr al aanwezig is)
    laadreferentie:    [reisnr, notaRef].filter(Boolean).join(' / ') || '',
    inleverreferentie: afzettenRef || '',
    inleverBestemming: '',

    rederijRaw:     rederijCode,
    rederij:        '',
    bootnaam,
    inleverRederij: '',
    inleverBootnaam: bootnaam,

    zegel,
    colli,
    lading,
    brutogewicht:   gewicht,
    geladenGewicht: gewicht,
    cbm,

    adr: 'Onwaar',
    gasmeten,
    ladenOfLossen: 'Laden',
    instructies: losOpm || '',
    tar: '', documentatie: '', tarra: '0', brix: '0',

    locaties
  }, { bron: 'Ritra' })];
}
