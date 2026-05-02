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
  const notaRef   = ls.find(l => /nota ref/i.test(l))?.match(/:\s*(\d{6,})/)?.[1] || '';

  // Uithaalreferentie (terminal PIN) — waarde vóór "Reisnr" label
  const reisnrIdx = ls.findIndex(l => /^Reisnr$/i.test(l));
  let releasenr = '';
  if (reisnrIdx > 0) {
    for (let i = reisnrIdx - 1; i >= Math.max(0, reisnrIdx - 5); i--) {
      if (/^\d{6,}$/.test(ls[i])) { releasenr = ls[i]; break; }
    }
  }

  // Inleverreferentie (afzet terminal PIN) — waarde vóór "Releasenummer" label
  // Vergroot zoekbereik tot 12: in Ritra PDF kan de waarde ver voor het label staan
  const releasenrIdx = ls.findIndex(l => /^Releasenummer$/i.test(l));
  let inleverreferentieRaw = '';
  if (releasenrIdx > 0) {
    for (let i = releasenrIdx - 1; i >= Math.max(0, releasenrIdx - 12); i--) {
      if (/^\d{7,}$/.test(ls[i])) { inleverreferentieRaw = ls[i]; break; }
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
  // In Ritra PDFs staat de waarde VOOR het label; bijv. "04/05/2026 om 10:00 uur" → "Leverdatum"
  let leverdatumNaAfhaal = '';
  let ritra_tijd = '';
  if (afhaalIdx >= 0) {
    const ldIdx = ls.findIndex((l, i) => i > afhaalIdx && /^Leverdatum$/i.test(l));
    if (ldIdx > 0) {
      for (let i = ldIdx - 1; i >= Math.max(0, ldIdx - 4); i--) {
        const line = ls[i] || '';
        const d = parseDatum(line);
        if (d) {
          leverdatumNaAfhaal = d;
          // Extraheer tijd: "04/05/2026 om 10:00 uur"
          const tijdM = line.match(/om\s+(\d{1,2}):(\d{2})/i)
                     || line.match(/\s+(\d{2}):(\d{2})(?:\s|$)/);
          if (tijdM) ritra_tijd = `${tijdM[1].padStart(2,'0')}:${tijdM[2]}:00`;
          break;
        }
      }
    }
  }

  // === Los opmerking / instructies / gasmeten ===
  // Formaat in PDF: "TAV STEINMEIJER/GASMEETING:Losopm"
  let gasmeten = 'Onwaar';
  let losOpm   = '';
  const losOpmLine = ls.find(l => /Losopm/i.test(l));
  if (losOpmLine) {
    const content = losOpmLine.replace(/:?Losopm.*$/i, '').trim();
    if (/gasme[ae]t/i.test(content)) gasmeten = 'Waar';
    losOpm = content.split('/').filter(p => !/gasme[ae]t/i.test(p)).join(' ').trim();
  }
  // Extra check: ergens in het document "gasmeting" / "gasmeeting" vermeld?
  if (gasmeten === 'Onwaar' && ls.some(l => /gasme[ae]t/i.test(l))) gasmeten = 'Waar';

  // Afzetten: terminal/depot na afleveradres — breed zoekpatroon (incl. Kramer, RCT, enz.)
  let afzettenNaam = '', afzettenAdres = '', afzettenRef = '';
  if (afleverIdx >= 0) {
    for (let i = afleverIdx + 1; i < Math.min(afleverIdx + 25, ls.length); i++) {
      if (TERMINAL_RE.test(ls[i]) && ls[i].length > 3) {
        afzettenNaam  = ls[i].replace(/,\s*$/, '').trim();
        afzettenAdres = ls[i + 1] || '';
        // Referentie: kijk of een van de volgende 4 regels een ref-patroon heeft
        for (let j = i + 1; j < Math.min(i + 6, ls.length); j++) {
          const refM = ls[j].match(/(?:referentie|ref\.?|reference)[:\s]+(.+)/i)
                    || ls[j].match(/^([A-Z][A-Z0-9 ]{2,}(?:\/|\\)[A-Z0-9 \/\\]+)$/i);
          if (refM) { afzettenRef = refM[1].trim(); break; }
          // Standalone bekende ref-waarden (bijv. "ONE STOCK", "Bestand")
          if (/^[A-Z]{2,}(?:\s+[A-Z0-9]+)+$/i.test(ls[j]) && ls[j].length < 40) {
            afzettenRef = ls[j].trim(); break;
          }
        }
        break;
      }
    }
  }
  if (!afzettenNaam) {
    afzettenNaam = (ls.find(l => /ECT.*Terminal|Euromax/i.test(l)) || '').replace(/,.*/, '').trim();
  }

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
    referentie:        releasenr || notaRef,
    laadreferentie:    notaRef   || '',
    inleverreferentie: inleverreferentieRaw || afzettenRef || '',
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
