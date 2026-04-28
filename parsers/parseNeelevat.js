// parsers/parseNeelevat.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode,
  getRederijNaam,
  getKlantData
} from '../utils/lookups/terminalLookup.js';

function normLand(val) {
  const s = (val || '').trim().toUpperCase();
  if (!s) return 'NL';
  if (s === 'NEDERLAND' || s === 'NETHERLANDS') return 'NL';
  if (s === 'DUITSLAND' || s === 'GERMANY' || s === 'DEUTSCHLAND') return 'DE';
  if (s === 'BELGIE' || s === 'BELGIË' || s === 'BELGIUM') return 'BE';
  return s;
}

function cleanFloat(val) {
  if (!val) return '';
  return String(val).trim().replace(/\.0+$/, '');
}

function parseDatum(str) {
  const m = (str || '').match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${parseInt(m[1])}-${parseInt(m[2])}-${yyyy}`;
}

/**
 * Extraheert een genummerde locatieblok uit de Neelevat PDF-regels.
 * Structuur: "N. Container terminal / Depot" of "N. Load/Unload"
 *            → optioneel "Depot"
 *            → naam (bijv. "Medrepair")
 *            → "Datum / tijd:"
 *            → datum
 *            → "adres  Referentie: ..."
 *            → "POSTCODE  PLAATS"
 *            → "Nederland"
 */
function extractSection(ls, startIdx) {
  let i = startIdx + 1;
  // Sla "Depot" of "terminal /" vervolgregels over
  while (i < startIdx + 4 && /^(Depot|terminal\s*\/)$/i.test(ls[i] || '')) i++;

  const naam = ls[i] || '';
  i++;

  let datum = '', adres = '', postcode = '', plaats = '', referentie = '';
  for (let j = i; j < startIdx + 14 && j < ls.length; j++) {
    if (/^Datum\s*\/\s*tijd\s*:?\s*$/i.test(ls[j])) {
      datum  = parseDatum(ls[j + 1] || '');
      const adresLine = ls[j + 2] || '';
      const refSplit  = adresLine.split(/\s*Referentie:\s*/i);
      adres      = refSplit[0].trim();
      referentie = (refSplit[1] || '').trim();
      const pcLine = ls[j + 3] || '';
      const pcM = pcLine.match(/^(\d{4})\s*([A-Z]{2})\s+(.*)/i);
      if (pcM) {
        postcode = `${pcM[1]} ${pcM[2]}`;
        plaats   = pcM[3].trim();
      }
      break;
    }
  }
  return { naam, datum, adres, postcode, plaats, referentie };
}

export default async function parseNeelevat(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { text } = await pdfParse(buffer);
  const ls = text.split('\n').map(r => r.trim()).filter(Boolean);
  console.log('📋 Neelevat regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // === Ritnummer (Onze referentie) ===
  const refIdx = ls.findIndex(l => /^referentie$/i.test(l));
  let ritnummer = '';
  if (refIdx >= 0) {
    const m = (ls[refIdx + 1] || '').match(/[:\s]*(\d{7,})/);
    if (m) ritnummer = m[1];
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
  const rederijRaw = labelValue(/^Rederij:\s*/i);

  // === Bootnaam ===
  const bootnaam = labelValue(/^Bootnaam:\s*/i);

  // === Bestemming (inleverBestemming) ===
  const bestemmingRaw = labelValue(/^Bestemming:\s*/i) || labelValue(/^Destination:\s*/i);

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

  // === Terminal & klant lookups ===
  const [opzettenInfo, afzettenInfo, opdrachtgever] = await Promise.all([
    getTerminalInfoMetFallback(loc1.naam || ''),
    getTerminalInfoMetFallback(loc3.naam || ''),
    getKlantData('neelevat')
  ]);
  if (!opzettenInfo) console.log(`⚠️ Opzet-terminal niet in lijst: "${loc1.naam}"`);
  if (!afzettenInfo) console.log(`⚠️ Afzet-terminal niet in lijst: "${loc3.naam}"`);
  const ctCode     = await getContainerTypeCode(containertypeDisplay) || '0';
  const rederijNaam = (await getRederijNaam(rederijRaw)) || rederijRaw;

  const datum = loc1.datum || loc2.datum || '';

  // Bijzonderheden bij onbekende terminals
  const onbekendeMeldingen = [];
  if (!opzettenInfo && loc1.naam) onbekendeMeldingen.push(`Opzet-terminal niet in lijst: ${loc1.naam}`);
  if (!afzettenInfo && loc3.naam) onbekendeMeldingen.push(`Afzet-terminal niet in lijst: ${loc3.naam}`);

  const locaties = [
    {
      volgorde: '0', actie: 'Opzetten',
      naam:     opzettenInfo?.naam     || loc1.naam     || '',
      adres:    opzettenInfo?.adres    || loc1.adres    || '',
      postcode: opzettenInfo?.postcode || loc1.postcode || '',
      plaats:   opzettenInfo?.plaats   || loc1.plaats   || '',
      land:     normLand(opzettenInfo?.land || 'NL'),
      voorgemeld:    opzettenInfo ? (opzettenInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar') : 'Onwaar',
      aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(opzettenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(opzettenInfo?.bicsCode      || '')
    },
    {
      volgorde: '0', actie: 'Laden',
      naam:     loc2.naam     || '',
      adres:    loc2.adres    || '',
      postcode: loc2.postcode || '',
      plaats:   loc2.plaats   || '',
      land:     'NL'
    },
    {
      volgorde: '0', actie: 'Afzetten',
      naam:     afzettenInfo?.naam     || loc3.naam     || '',
      adres:    afzettenInfo?.adres    || loc3.adres    || '',
      postcode: afzettenInfo?.postcode || loc3.postcode || '',
      plaats:   afzettenInfo?.plaats   || loc3.plaats   || '',
      land:     normLand(afzettenInfo?.land || 'NL'),
      voorgemeld:    afzettenInfo ? (afzettenInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar') : 'Onwaar',
      aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(afzettenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(afzettenInfo?.bicsCode      || '')
    }
  ];

  return [{
    ritnummer,
    klantnaam:     loc2.naam     || '',
    klantadres:    loc2.adres    || '',
    klantpostcode: loc2.postcode || '',
    klantplaats:   loc2.plaats   || '',

    opdrachtgeverNaam:     opdrachtgever?.naam     || 'NEELEVAT',
    opdrachtgeverAdres:    opdrachtgever?.adres    || '',
    opdrachtgeverPostcode: opdrachtgever?.postcode || '',
    opdrachtgeverPlaats:   opdrachtgever?.plaats   || '',
    opdrachtgeverTelefoon: opdrachtgever?.telefoon || '',
    opdrachtgeverEmail:    opdrachtgever?.email    || '',
    opdrachtgeverBTW:      opdrachtgever?.btw      || '',
    opdrachtgeverKVK:      opdrachtgever?.kvk      || '',

    containernummer,
    containertype:     containertypeDisplay,
    containertypeCode: ctCode,

    datum,
    tijd: '',
    referentie:        loc1.referentie || '',
    laadreferentie:    loc2.referentie || '',
    inleverreferentie: loc3.referentie || '',
    inleverBestemming: bestemmingRaw  || '',

    rederij:         rederijNaam,
    bootnaam:        '',
    inleverRederij:  rederijNaam,
    inleverBootnaam: bootnaam,

    zegel:          '',
    colli:          '0',
    lading,
    brutogewicht:   gewicht,
    geladenGewicht: gewicht,
    cbm:            '0',

    adr:           'Onwaar',
    ladenOfLossen: 'Laden',
    instructies:   onbekendeMeldingen.join(' | '),
    tar: '', documentatie: '', tarra: '0', brix: '0',

    locaties
  }];
}
