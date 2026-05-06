// parsers/parseNeelevat.js
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

/**
 * Extraheert een genummerd locatieblok uit de Neelevat PDF-regels.
 *
 * Ondersteunt twee varianten:
 *
 * Formaat A (standaard):
 *   N. Container terminal / Depot
 *   [optioneel "Depot"]
 *   Naam
 *   Datum / tijd :
 *   DD/MM/YYYY [om HH:MM uur]
 *   Adres  Referentie: XXX
 *   POSTCODE PLAATS
 *
 * Formaat B (Neelevat Ocean / SEF):
 *   N. Container terminal /
 *   Depot
 *   Naam DD/MM/YYYY HH:MM          ← datum ingebed op naamregel (sec1 + sec3)
 *   Datum / tijd :
 *   Adres  Referentie : XXX        ← let op spatie vóór ":"
 *   POSTCODE PLAATS
 *
 *   of (sec2 in SEF):
 *   N. Load/Unload
 *   DD/MM/YYYY                     ← datum op eigen regel vóór naam
 *   Naam
 *   Datum / tijd :
 *   Adres  Referentie : XXX
 *   POSTCODE PLAATS
 */
function extractSection(ls, startIdx) {
  let i = startIdx + 1;
  // Sla "Depot" of "terminal /" vervolgregels over
  while (i < startIdx + 4 && /^(Depot|terminal\s*\/)$/i.test(ls[i] || '')) i++;

  // Formaat B (sec2): losse datumregel VÓÓR de naam ("08-05-2026\nOOSTVOGELS LOGISTICS")
  let datumVoorNaam = '';
  const eersteRegel = ls[i] || '';
  if (/^\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}(\s+\d{1,2}:\d{2})?\s*$/.test(eersteRegel)) {
    datumVoorNaam = parseDatum(eersteRegel);
    i++;
  }

  let naamRaw = ls[i] || '';
  i++;

  // Formaat B (sec1/sec3): datum ingebed aan het einde van de naamregel
  // bijv. "CETEM CONTAINERS BV 08-05-2026 14:00" of "Euromax Terminal 08-05-2026"
  let datumUitNaam = '', tijdUitNaam = '';
  const datumOpNaamMatch = naamRaw.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\s*(\d{2}:\d{2})?\s*$/);
  if (datumOpNaamMatch) {
    datumUitNaam = parseDatum(datumOpNaamMatch[1]);
    tijdUitNaam  = datumOpNaamMatch[2] ? `${datumOpNaamMatch[2]}:00` : '';
    naamRaw      = naamRaw.replace(datumOpNaamMatch[0], '').trim();
  }
  const naam = naamRaw;

  // Datum-voor-naam heeft prioriteit boven datum-in-naam
  let datum = datumVoorNaam || datumUitNaam;
  let tijd  = tijdUitNaam;
  let adres = '', postcode = '', plaats = '', referentie = '';

  for (let j = i; j < startIdx + 16 && j < ls.length; j++) {
    if (/^Datum\s*\/\s*tijd\s*:?\s*$/i.test(ls[j])) {
      const volgende = ls[j + 1] || '';
      const datumGeparsed = parseDatum(volgende);

      if (datumGeparsed) {
        // Formaat A: volgende regel is de datum
        if (!datum) datum = datumGeparsed;
        const omM = volgende.match(/\bom\s+(\d{2})(\d{2})\s*uur\b/i)
                 || volgende.match(/\bom\s+(\d{1,2}):(\d{2})/i);
        if (omM) {
          tijd = `${omM[1].padStart(2, '0')}:${omM[2]}:00`;
        } else {
          const tijdM = volgende.match(/\b(\d{1,2}):(\d{2})\b/);
          if (tijdM) tijd = `${tijdM[1].padStart(2, '0')}:${tijdM[2]}:00`;
        }
        const adresLine = ls[j + 2] || '';
        const refSplit  = adresLine.split(/\s*Referentie\s*:\s*/i);
        adres      = refSplit[0].trim();
        referentie = (refSplit[1] || '').trim();
        const pcLine = ls[j + 3] || '';
        const pcM = pcLine.match(/^(\d{4})\s*([A-Z]{2})\s+(.*)/i);
        if (pcM) { postcode = `${pcM[1]} ${pcM[2]}`; plaats = pcM[3].trim(); }
      } else {
        // Formaat B: datum staat al op naam-/pre-naamregel; volgende regel is het adres
        const adresLine = volgende;
        const refSplit  = adresLine.split(/\s*Referentie\s*:\s*/i);
        adres      = refSplit[0].trim();
        referentie = (refSplit[1] || '').trim();
        const pcLine = ls[j + 2] || '';
        const pcM = pcLine.match(/^(\d{4})\s*([A-Z]{2})\s+(.*)/i);
        if (pcM) { postcode = `${pcM[1]} ${pcM[2]}`; plaats = pcM[3].trim(); }
      }
      break;
    }
  }
  return { naam, datum, tijd, adres, postcode, plaats, referentie };
}

export default async function parseNeelevat(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { lines: ls } = await extractPdfText(buffer, 'Neelevat transportopdracht');
  console.log('📋 Neelevat regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // === Ritnummer (Onze referentie) ===
  // Formaat A: aparte regel "referentie" gevolgd door het nummer
  const refIdx = ls.findIndex(l => /^referentie$/i.test(l));
  let ritnummer = '';
  if (refIdx >= 0) {
    const m = (ls[refIdx + 1] || '').match(/[:\s]*(\d{7,})/);
    if (m) ritnummer = m[1];
  }
  // Formaat B (Neelevat Ocean SEF): "... Onze : 1802192701 ..." op één regel
  if (!ritnummer) {
    const onzeLijn = ls.find(l => /\bOnze\s*:\s*\d{7,}/i.test(l));
    if (onzeLijn) {
      const m = onzeLijn.match(/\bOnze\s*:\s*(\d{7,})/i);
      if (m) ritnummer = m[1];
    }
  }

  // === Container nummer ===
  const containerNrLine = ls.find(l => /[A-Z]{3}U\d{7}/i.test(l)) || '';
  const containernummer = (containerNrLine.match(/([A-Z]{3}U\d{7})/i)?.[1] || '').toUpperCase();

  // Helper: haal waarde op achter een label — of op de volgende regel als de waarde ontbreekt
  function labelValue(regex) {
    const idx = ls.findIndex(l => regex.test(l));
    if (idx < 0) return '';
    const inline = ls[idx].replace(regex, '').trim();
    if (inline) return inline;
    // Waarde staat op volgende regel
    return (ls[idx + 1] || '').trim();
  }

  // === Rederij ===
  const rederijRaw = labelValue(/^Rederij\s*:?\s*/i) || labelValue(/^Carrier\s*:?\s*/i) || labelValue(/^Shipping\s*line\s*:?\s*/i);

  // === Bootnaam ===
  const bootnaamRaw = labelValue(/^Bootnaam\s*:?\s*/i) || labelValue(/^Vessel\s*:?\s*/i) || labelValue(/^Schip\s*:?\s*/i);

  // === Bestemming (inleverBestemming) ===
  const bestemmingRaw = labelValue(/^Bestemming\s*:?\s*/i) || labelValue(/^Destination\s*:?\s*/i);

  // === Containertype ===
  const containerIdx = ls.findIndex(l => /^Container$/i.test(l));
  let containerRaw = '';
  if (containerIdx >= 0) {
    containerRaw = (ls[containerIdx + 1] || '')
      .replace(/^:\s*\d+\s*x\s*/i, '')
      .replace(/[()]/g, '')
      .trim();
  }
  // Normaliseer voor lookup: "20 FT STANDAARD CONTAINER" → "20 FT STANDARD CONTAINER"
  const containertypeDisplay = containerRaw
    .replace(/standaard/gi, 'standard')
    .toLowerCase()
    .trim();

  // === Lading & Gewicht ===
  const ladingHeaderIdx = ls.findIndex(l => /Lading\s*omschrijving/i.test(l));
  let lading = '';
  let gewicht = '0';
  if (ladingHeaderIdx >= 0) {
    const ladingLines = [];
    for (let i = ladingHeaderIdx + 1; i < Math.min(ladingHeaderIdx + 25, ls.length); i++) {
      const line = ls[i];
      if (/^\d+\.\s+(Container|Load)/i.test(line)) break;   // sectieheader
      if (/^s\.t\.c\.$/i.test(line)) continue;              // skip s.t.c.
      // Gewichtregel: "9700.00" of "9700.001  20FT"
      if (/^\d+[.,]\d{2}$/.test(line)) {
        if (gewicht === '0') gewicht = String(Math.round(parseFloat(line.replace(',', '.'))));
        continue;
      }
      if (/^\d+[.,]\d+\s+.*\d+FT\s*$/i.test(line)) {
        const wm = line.match(/^(\d+[.,]\d+)/);
        if (wm && gewicht === '0') gewicht = String(Math.round(parseFloat(wm[1].replace(',', '.'))));
        continue;
      }
      if (/\w/.test(line)) ladingLines.push(line);
    }
    lading = ladingLines.join('; ');
  }

  // === Locaties (1. Container terminal, 2. Load/Unload, 3. Container terminal) ===
  const sec1Idx = ls.findIndex(l => /^1\.\s+Container/i.test(l));
  const sec2Idx = ls.findIndex(l => /^2\.\s+Load/i.test(l));
  const sec3Idx = ls.findIndex((l, i) => i > sec2Idx && /^3\.\s+Container/i.test(l));

  const loc1 = sec1Idx >= 0 ? extractSection(ls, sec1Idx) : {};
  const loc2 = sec2Idx >= 0 ? extractSection(ls, sec2Idx) : {};
  const loc3 = sec3Idx >= 0 ? extractSection(ls, sec3Idx) : {};

  console.log(`🏭 Neelevat secties: sec1[${sec1Idx}] naam="${loc1.naam}" ref="${loc1.referentie}" | sec2[${sec2Idx}] naam="${loc2.naam}" ref="${loc2.referentie}" | sec3[${sec3Idx}] naam="${loc3.naam}" ref="${loc3.referentie}"`);

  const datum = loc1.datum || loc2.datum || '';
  const tijd  = loc2.tijd  || loc1.tijd  || '';

  // Ruwe locaties — enrichOrder doet alle lookups
  const locaties = [
    { volgorde: '0', actie: 'Opzetten', naam: loc1.naam || '', adres: loc1.adres || '', postcode: loc1.postcode || '', plaats: loc1.plaats || '', land: 'NL' },
    { volgorde: '0', actie: 'Laden',    naam: loc2.naam || '', adres: loc2.adres || '', postcode: loc2.postcode || '', plaats: loc2.plaats || '', land: 'NL' },
    { volgorde: '0', actie: 'Afzetten', naam: loc3.naam || '', adres: loc3.adres || '', postcode: loc3.postcode || '', plaats: loc3.plaats || '', land: 'NL' }
  ];

  return [await enrichOrder({
    ritnummer,
    klantnaam:     loc2.naam     || '',
    klantadres:    loc2.adres    || '',
    klantpostcode: loc2.postcode || '',
    klantplaats:   loc2.plaats   || '',

    opdrachtgeverNaam:     'NEELEVAT',
    opdrachtgeverAdres:    'SEATTLEWEG 13',
    opdrachtgeverPostcode: '3195 ND',
    opdrachtgeverPlaats:   'ROTTERDAM',
    opdrachtgeverTelefoon: '',
    opdrachtgeverEmail:    'Oceanexports@neelevat.com',
    opdrachtgeverBTW:      '',
    opdrachtgeverKVK:      '24180616',

    containernummer,
    containertype:     containertypeDisplay,

    datum,
    tijd,
    referentie:        loc1.referentie || '',
    laadreferentie:    loc2.referentie || '',
    inleverreferentie: loc3.referentie || '',
    inleverBestemming: bestemmingRaw  || '',

    rederijRaw,
    rederij:         '',
    bootnaam:        '',
    inleverRederij:  '',
    inleverBootnaam: bootnaamRaw,

    zegel:          '',
    colli:          '0',
    lading,
    brutogewicht:   gewicht,
    geladenGewicht: gewicht,
    cbm:            '0',

    adr:           'Onwaar',
    ladenOfLossen: 'Laden',
    instructies:   '',
    tar: '', documentatie: '', tarra: '0', brix: '0',

    locaties
  }, { bron: 'Neelevat' })];
}
