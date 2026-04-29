// parsers/parseSteder.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getAdresboekEntry,
  voegAdresboekEntryToe,
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
 * Extraheert een genummerde locatieblok (Neelevat-stijl):
 * "N. Container terminal / Depot" of "N. Load/Unload" of "N. Laden" of "N. Lossen"
 */
function extractSection(ls, startIdx) {
  let i = startIdx + 1;
  while (i < startIdx + 4 && /^(Depot|terminal\s*\/)$/i.test(ls[i] || '')) i++;

  const naam = ls[i] || '';
  i++;

  let datum = '', tijd = '', adres = '', postcode = '', plaats = '', referentie = '';
  for (let j = i; j < startIdx + 14 && j < ls.length; j++) {
    if (/^Datum\s*[\/\-]?\s*tijd\s*:?\s*$/i.test(ls[j])) {
      const datumTijdLine = ls[j + 1] || '';
      datum = parseDatum(datumTijdLine);
      const tijdM = datumTijdLine.match(/(\d{1,2}:\d{2})/);
      if (tijdM) tijd = tijdM[1];
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
  return { naam, datum, tijd, adres, postcode, plaats, referentie };
}

export default async function parseSteder(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { text } = await pdfParse(buffer);
  const ls = text.split('\n').map(r => r.trim()).filter(Boolean);
  console.log('📋 Steder regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // Helper: waarde achter label of op volgende regel
  function labelValue(regex) {
    const idx = ls.findIndex(l => regex.test(l));
    if (idx < 0) return '';
    const inline = ls[idx].replace(regex, '').trim();
    if (inline) return inline;
    return (ls[idx + 1] || '').trim();
  }

  // === Ritnummer ===
  // Steder formaat: "Opdrachtnummer:" of bracket formaat "[1901016826-...]"
  let ritnummer = '';
  const opdrNrLine = ls.find(l => /opdrachtnummer|opdracht\s*nr/i.test(l));
  if (opdrNrLine) {
    ritnummer = opdrNrLine.match(/[:\s]+(\d{6,})/)?.[1] || '';
  }
  if (!ritnummer) {
    // Bracket-formaat of los getal
    const nrLine = ls.find(l => /\[?\d{7,}/.test(l) && !/postcode|datum/i.test(l));
    ritnummer = nrLine?.match(/(\d{7,})/)?.[1] || '';
  }

  // === Container nummer ===
  const containerNrLine = ls.find(l => /[A-Z]{3}U\d{7}/i.test(l)) || '';
  const containernummer = (containerNrLine.match(/([A-Z]{3}U\d{7})/i)?.[1] || '').toUpperCase();

  // === Rederij & Bootnaam ===
  const rederijRaw   = labelValue(/^Rederij\s*:?\s*/i) || labelValue(/^Carrier\s*:?\s*/i);
  const bootnaamRaw  = labelValue(/^Bootnaam\s*:?\s*/i) || labelValue(/^Vessel\s*:?\s*/i) || labelValue(/^Schip\s*:?\s*/i);
  const bestemmingRaw = labelValue(/^Bestemming\s*:?\s*/i) || labelValue(/^Destination\s*:?\s*/i);

  // === Containertype + colli uit containerregel ===
  const containerIdx = ls.findIndex(l => /^Container$/i.test(l));
  let containerRaw = '';
  let colliUitContainer = '0';
  if (containerIdx >= 0) {
    const containerLine = ls[containerIdx + 1] || '';
    const qtyM = containerLine.match(/^:\s*(\d+)\s*x/i);
    if (qtyM) colliUitContainer = qtyM[1];
    containerRaw = containerLine
      .replace(/^:\s*\d+\s*x\s*/i, '')
      .replace(/[()]/g, '')
      .trim();
  }
  // Fallback: zoek op "20FT" of "40FT" patroon
  if (!containerRaw) {
    containerRaw = ls.find(l => /\d{2}\s*ft/i.test(l) && !/datum/i.test(l)) || '';
  }
  const containertypeDisplay = containerRaw
    .replace(/standaard/gi, 'standard')
    .toLowerCase()
    .trim();

  // === Lading & Gewicht ===
  const ladingHeaderIdx = ls.findIndex(l => /Lading\s*omschrijving|Cargo\s*description|KindColli/i.test(l));
  let lading = '';
  let gewicht = '0';
  let colli = '0';
  if (ladingHeaderIdx >= 0) {
    const ladingLines = [];
    for (let i = ladingHeaderIdx + 1; i < Math.min(ladingHeaderIdx + 25, ls.length); i++) {
      const line = ls[i];
      if (/^\d+\.\s+(Container|Load|Laden|Lossen)/i.test(line)) break;
      if (/^s\.t\.c\.$/i.test(line)) continue;
      // "Colli 1 = 425x90x130cm ..." — genummerde colli-items, pak hoogste nummer
      const colliNrM = line.match(/^Colli\s+(\d+)\s*[=:\-]/i);
      if (colliNrM) {
        const n = parseInt(colliNrM[1]);
        if (n > parseInt(colli || '0')) colli = String(n);
        continue;
      }
      // "6 COLLI" — los getal gevolgd door COLLI
      const colliAlleen = line.match(/^(\d+)\s+colli/i);
      if (colliAlleen) { colli = colliAlleen[1]; continue; }
      // "12750.006  6  COLLI" — gewicht + aantal + COLLI
      const colliM = line.match(/^[\d.,]+\s+(\d+)\s+colli/i);
      if (colliM) { colli = colliM[1]; continue; }
      if (/colli/i.test(line)) continue;   // resterende COLLI-regels overslaan
      if (/^\d+[.,]\d{2}$/.test(line)) {
        if (gewicht === '0') gewicht = String(Math.round(parseFloat(line.replace(',', '.'))));
        continue;
      }
      if (/^\d+[.,]\d+\s+.*\d+FT\s*$/i.test(line)) {
        const wm = line.match(/^(\d+[.,]\d+)/);
        if (wm && gewicht === '0') gewicht = String(Math.round(parseFloat(wm[1].replace(',', '.'))));
        continue;
      }
      if (/^\d+[.,]\d+\s*kg\s*$/i.test(line)) {
        if (gewicht === '0') gewicht = String(Math.round(parseFloat(line.replace(/[^\d.,]/g, '').replace(',', '.'))));
        continue;
      }
      if (/\w/.test(line)) ladingLines.push(line);
    }
    lading = ladingLines.join('; ');
  }
  // Fallback: colli uit "1 x container" regel als lading-sectie geen colli had
  if (colli === '0') colli = colliUitContainer;

  // === Locaties — probeer eerst Neelevat-stijl (1./2./3.), dan Ritra-stijl ===
  const sec1Idx = ls.findIndex(l => /^1\.\s+(Container|Depot|Terminal)/i.test(l));
  const sec2Idx = ls.findIndex(l => /^2\.\s+(Load|Laden|Lossen|Klant)/i.test(l));
  const sec3Idx = ls.findIndex((l, i) => i > (sec2Idx >= 0 ? sec2Idx : 0) && /^3\.\s+(Container|Depot|Terminal)/i.test(l));

  let loc1 = {}, loc2 = {}, loc3 = {};
  let ladenOfLossen = containernummer ? 'Lossen' : 'Laden';

  if (sec1Idx >= 0) {
    // Neelevat-stijl genummerde secties
    loc1 = extractSection(ls, sec1Idx);
    if (sec2Idx >= 0) loc2 = extractSection(ls, sec2Idx);
    if (sec3Idx >= 0) loc3 = extractSection(ls, sec3Idx);
    console.log(`📍 Steder secties (Neelevat-stijl): sec1[${sec1Idx}] "${loc1.naam}" | sec2[${sec2Idx}] "${loc2.naam}" | sec3[${sec3Idx}] "${loc3.naam}"`);
  } else {
    // Ritra-stijl: Afhaaladres / Afleveradres
    const afhaalIdx  = ls.findIndex(l => /^Afhaaladres$/i.test(l));
    const afleverIdx = ls.findIndex(l => /^Afleveradres$/i.test(l));
    if (afhaalIdx >= 0) {
      const lines = [];
      for (let i = afhaalIdx + 1; i < Math.min(afhaalIdx + 8, ls.length); i++) {
        if (/^(Leverdatum|Afleveradres)$/i.test(ls[i])) break;
        if (ls[i] !== ':') lines.push(ls[i]);
      }
      loc2 = { naam: lines[0] || '', adres: lines[1] || '', postcode: lines[2] || '', plaats: lines[3] || '', datum: '', referentie: '' };
    }
    if (afleverIdx >= 0) {
      for (let i = afleverIdx + 1; i < Math.min(afleverIdx + 10, ls.length); i++) {
        if (/ECT|Euromax|terminal|RWG|APM|Delta/i.test(ls[i])) {
          loc3 = { naam: ls[i], datum: '', adres: '', postcode: '', plaats: '', referentie: '' };
          break;
        }
      }
    }
    console.log(`📍 Steder secties (Ritra-stijl): afhaal="${loc2.naam}" afzet="${loc3.naam}"`);
  }

  // Datum = klant-afspraak (sectie 2), niet terminal-datum (sectie 1)
  const datum = loc2.datum || loc1.datum || '';
  const tijd  = loc2.tijd  || loc1.tijd  || '';

  // === Terminal & klant lookups ===
  const [opzettenInfo, afzettenInfo, opdrachtgever, ladenInfo] = await Promise.all([
    getTerminalInfoMetFallback(loc1.naam || ''),
    getTerminalInfoMetFallback(loc3.naam || ''),
    getKlantData('steder'),
    getAdresboekEntry(loc2.naam || '', null, loc2.adres || '')
  ]);
  if (!opzettenInfo) console.log(`⚠️ Opzet-terminal niet in lijst: "${loc1.naam}"`);
  if (!afzettenInfo) console.log(`⚠️ Afzet-terminal niet in lijst: "${loc3.naam}"`);
  if (!ladenInfo && loc2.naam && loc2.adres) {
    await voegAdresboekEntryToe({ naam: loc2.naam, adres: loc2.adres, postcode: loc2.postcode || '', plaats: loc2.plaats || '', type: 'Klant', bron: 'Steder auto' });
  }
  const ctCode      = await getContainerTypeCode(containertypeDisplay) || '0';
  const rederijNaam = (await getRederijNaam(rederijRaw)) || '';
  if (rederijRaw && !rederijNaam) console.warn(`⚠️ Steder rederij "${rederijRaw}" niet gevonden — veld leeggemaakt`);

  const onbekendeMeldingen = [];
  if (!opzettenInfo && loc1.naam) onbekendeMeldingen.push(`Opzet-terminal niet in lijst: ${loc1.naam}`);
  if (!afzettenInfo && loc3.naam) onbekendeMeldingen.push(`Afzet-terminal niet in lijst: ${loc3.naam}`);

  const locaties = [
    {
      volgorde: '0', actie: 'Opzetten',
      naam:          opzettenInfo?.naam     || loc1.naam     || '',
      adres:         opzettenInfo?.adres    || loc1.adres    || '',
      postcode:      opzettenInfo?.postcode || loc1.postcode || '',
      plaats:        opzettenInfo?.plaats   || loc1.plaats   || '',
      land:          normLand(opzettenInfo?.land || 'NL'),
      voorgemeld:    opzettenInfo ? (opzettenInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar') : 'Onwaar',
      aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(opzettenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(opzettenInfo?.bicsCode      || '')
    },
    {
      volgorde: '0', actie: ladenOfLossen,
      naam:     ladenInfo?.naam     || loc2.naam     || '',
      adres:    ladenInfo?.adres    || loc2.adres    || '',
      postcode: ladenInfo?.postcode || loc2.postcode || '',
      plaats:   ladenInfo?.plaats   || loc2.plaats   || '',
      land:     'NL'
    },
    {
      volgorde: '0', actie: 'Afzetten',
      naam:          afzettenInfo?.naam     || loc3.naam     || '',
      adres:         afzettenInfo?.adres    || loc3.adres    || '',
      postcode:      afzettenInfo?.postcode || loc3.postcode || '',
      plaats:        afzettenInfo?.plaats   || loc3.plaats   || '',
      land:          normLand(afzettenInfo?.land || 'NL'),
      voorgemeld:    afzettenInfo ? (afzettenInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar') : 'Onwaar',
      aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(afzettenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(afzettenInfo?.bicsCode      || '')
    }
  ];

  return [{
    ritnummer,
    klantnaam:     ladenInfo?.naam     || loc2.naam     || '',
    klantadres:    ladenInfo?.adres    || loc2.adres    || '',
    klantpostcode: ladenInfo?.postcode || loc2.postcode || '',
    klantplaats:   ladenInfo?.plaats   || loc2.plaats   || '',

    opdrachtgeverNaam:     opdrachtgever?.naam     || 'STEDER',
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
    tijd,
    referentie:        loc1.referentie || '',
    laadreferentie:    loc2.referentie || '',
    inleverreferentie: loc3.referentie || '',
    inleverBestemming: bestemmingRaw   || '',

    rederij:         rederijNaam,
    bootnaam:        ladenOfLossen === 'Lossen' ? bootnaamRaw : '',
    inleverRederij:  rederijNaam,
    inleverBootnaam: ladenOfLossen === 'Laden'  ? bootnaamRaw : '',

    zegel:          '',
    colli,
    lading,
    brutogewicht:   gewicht,
    geladenGewicht: gewicht,
    cbm:            '0',

    adr:           'Onwaar',
    ladenOfLossen,
    instructies:   onbekendeMeldingen.join(' | '),
    tar: '', documentatie: '', tarra: '0', brix: '0',

    locaties
  }];
}
