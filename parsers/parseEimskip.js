// parsers/parseEimskip.js
// Eimskip "Transportopdracht" PDF parser
// PDF structuur:
//   Referentie → :NNNNN - NNNNN -
//   Schip: \n NAAM
//   Rederij: NAAM
//   Container: XXXUNNNNNNN (ISO_CODE)
//   Rederij zegel: ZEGEL
//   Goederen omschrijving... → STC61  CT 5410.00
//   1. Terminal depot → Opzetten
//   2. Delivery address → Lossen (met klantnaam)
//   3. Terminal depot → Afzetten
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getAdresboekEntry,
  getKlantData
} from '../utils/lookups/terminalLookup.js';

// ISO container type → EasyTrip omschrijving
const ISO_TYPE = {
  '20G0': '20 ft standard', '20G1': '20 ft standard',
  '22G0': '20 ft standard', '22G1': '20 ft standard',
  '40G0': '40 ft standard', '40G1': '40 ft standard',
  '42G0': '40 ft standard', '42G1': '40 ft standard',
  '45G0': '40 ft hc',       '45G1': '40 ft hc',
  'L0G0': '45 ft hc',       'L0G1': '45 ft hc',
  'L5G0': '45 ft hc',       'L5G1': '45 ft hc',
  '22R0': '20 ft reefer',    '22R1': '20 ft reefer',
  '42R0': '40 ft reefer',    '42R1': '40 ft reefer',
  '45R0': '40 ft reefer hc', '45R1': '40 ft reefer hc',
};

function normLand(val) {
  const s = (val || '').trim().toUpperCase();
  if (!s) return 'NL';
  if (/^(NEDERLAND|NETHERLANDS|NL)$/.test(s)) return 'NL';
  if (/^(DUITSLAND|GERMANY|DEUTSCHLAND|DE)$/.test(s)) return 'DE';
  if (/^(BELGI[EÈ]|BELGIUM|BE)$/.test(s)) return 'BE';
  if (/^(UNITED KINGDOM|UK|GB)$/.test(s)) return 'GB';
  if (/^(FRANCE|FRANKRIJK|FR)$/.test(s)) return 'FR';
  if (/^(LUXEMBOURG|LUXEMBURG|LU)$/.test(s)) return 'LU';
  if (/^(SPAIN|SPANJE|ES)$/.test(s)) return 'ES';
  return s.length === 2 ? s : 'NL';
}

function parseDatum(str) {
  const m = (str || '').match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${parseInt(m[1])}-${parseInt(m[2])}-${yyyy}`;
}

function parsePostcodeStad(pcStad) {
  const pcNL = pcStad.match(/^(\d{4}\s*[A-Z]{2})\s+(.*)/i);
  const pcBE = pcStad.match(/^(\d{4})\s+(.*)/);
  if (pcNL) return { postcode: pcNL[1].trim().toUpperCase(), plaats: pcNL[2].trim() };
  if (pcBE) return { postcode: pcBE[1].trim(),               plaats: pcBE[2].trim() };
  return { postcode: '', plaats: pcStad.trim() };
}

/**
 * Extraheer een sectie uit de PDF-regels.
 * Formaat na sectieheader (bijv. "2. Delivery address"):
 *   naam
 *   :              (separator)
 *   datum [tijd]
 *   adres
 *   : PORTBASE     (optioneel — overslaan)
 *   postcode+stad
 *   land
 */
function extractSectie(pls, headerIdx) {
  if (headerIdx < 0) return null;
  let i = headerIdx + 1;
  if (i >= pls.length) return null;

  const naam = (pls[i++] || '').trim();

  // Skip ":"
  while (i < pls.length && /^\s*:\s*$/.test(pls[i])) i++;

  const datumTijdLijn = (pls[i++] || '').trim();
  const datumM  = datumTijdLijn.match(/(\d{2}-\d{2}-\d{4})/);
  const tijdM   = datumTijdLijn.match(/(\d{1,2}:\d{2})/);
  const datum   = datumM ? parseDatum(datumM[1]) : '';
  const tijd    = tijdM  ? tijdM[1] : '';

  const adres = (pls[i++] || '').trim();

  // Skip ": PORTBASE" of ": ?"
  while (i < pls.length && /^\s*:/.test(pls[i])) i++;

  const pcStadLijn = (pls[i++] || '').trim();
  const landRaw    = (pls[i++] || '').trim();

  const { postcode, plaats } = parsePostcodeStad(pcStadLijn);
  const land = normLand(landRaw);

  return { naam, datum, tijd, adres, postcode, plaats, land };
}

/**
 * Verwerk de tekst-regels van de Eimskip Transportopdracht PDF.
 */
function parsePDFLines(pls) {
  // ── Referentie ──────────────────────────────────────────────────────────
  const refIdx = pls.findIndex(l => /^referentie\s*$/i.test(l));
  let ritnummer     = '';
  let laadreferentie = '';
  if (refIdx >= 0) {
    const volgende = (pls[refIdx + 1] || '').replace(/^:/, '').trim();
    const nrs = volgende.match(/\d{5,}/g) || [];
    ritnummer      = nrs[0] || '';
    laadreferentie = volgende.replace(/\s*-\s*$/, '').trim();  // bijv. "120563 - 520483"
  }

  // ── Schip ──────────────────────────────────────────────────────────────
  const schipIdx = pls.findIndex(l => /^schip\s*:?\s*$/i.test(l));
  const bootnaam = schipIdx >= 0 ? (pls[schipIdx + 1] || '').trim() : '';

  // ── Rederij (inline: "Rederij: NAAM") ─────────────────────────────────
  const rederijLine = pls.find(l => /^rederij\s*:/i.test(l));
  const rederij     = rederijLine ? rederijLine.replace(/^rederij\s*:\s*/i, '').trim() : '';

  // ── Container + ISO type ───────────────────────────────────────────────
  const containerLine = pls.find(l => /^container\s*:/i.test(l));
  let containernummer   = '';
  let containertypeIso  = '';
  if (containerLine) {
    const m = containerLine.match(/Container\s*:\s*([A-Z]{3,4}U?\d{6,7})\s*\(([^)]+)\)/i);
    if (m) { containernummer = m[1].toUpperCase(); containertypeIso = m[2].toUpperCase(); }
    // fallback: containernummer zonder type
    if (!containernummer) {
      const m2 = containerLine.match(/Container\s*:\s*([A-Z]{4}\d{7})/i);
      if (m2) containernummer = m2[1].toUpperCase();
    }
  }

  // ── Rederij zegel ─────────────────────────────────────────────────────
  const zegelLine = pls.find(l => /^rederij\s*zegel\s*:/i.test(l));
  const zegel     = zegelLine ? zegelLine.replace(/^rederij\s*zegel\s*:\s*/i, '').trim() : '';

  // ── Goederen / gewicht ─────────────────────────────────────────────────
  let lading = '', brutogewicht = '0', colli = '0';
  const goederenIdx = pls.findIndex(l => /goederen\s*omschrijving/i.test(l));
  if (goederenIdx >= 0 && goederenIdx + 1 < pls.length) {
    const gl = pls[goederenIdx + 1] || '';
    // "STC61  CT 5410.00" → lading=STC, colli=61, gewicht=5410
    const ladingM = gl.match(/^([A-Z]{2,})/i);
    if (ladingM) lading = ladingM[1].toUpperCase();
    const colliM = gl.match(/^[A-Z]+(\d+)/i);
    if (colliM) colli = colliM[1];
    const gewM = gl.match(/([\d]+(?:[.,]\d+)?)\s*$/);
    if (gewM) brutogewicht = String(Math.round(parseFloat(gewM[1].replace(',', '.'))));
  }

  // ── Secties ────────────────────────────────────────────────────────────
  const sec1Idx = pls.findIndex(l => /^1\.\s+terminal\s+depot/i.test(l));
  const sec2Idx = pls.findIndex(l => /^2\.\s+delivery\s+address/i.test(l));
  const sec3Idx = pls.findIndex((l, i) => i > sec2Idx && /^3\.\s+terminal\s+depot/i.test(l));

  const sec1 = extractSectie(pls, sec1Idx);
  const sec2 = extractSectie(pls, sec2Idx);
  const sec3 = extractSectie(pls, sec3Idx);

  console.log(`🔍 PDF: container=${containernummer} type=${containertypeIso} zegel=${zegel}`);
  console.log(`🔍 PDF: sec1="${sec1?.naam}" sec2="${sec2?.naam}" sec3="${sec3?.naam}"`);
  console.log(`🔍 PDF: ref="${laadreferentie}" rederij="${rederij}" schip="${bootnaam}"`);

  return { ritnummer, laadreferentie, bootnaam, rederij, containernummer, containertypeIso,
           zegel, lading, brutogewicht, colli, sec1, sec2, sec3 };
}

// Fallback: adres uit email body (na "leveren in [STAD]:")
function extractAdresUitBody(lines) {
  const trigIdx = lines.findIndex(l => l.endsWith(':') && /leveren/i.test(l));
  if (trigIdx < 0) return null;
  const bl = [];
  for (let i = trigIdx + 1; i < lines.length && bl.length < 3; i++) {
    if (lines[i].trim()) bl.push(lines[i].trim());
  }
  if (bl.length < 2) return null;
  const { postcode, plaats } = parsePostcodeStad(bl[1] || '');
  return { naam: '', adres: bl[0], postcode, plaats, land: normLand(bl[2] || '') || 'BE' };
}

export default async function parseEimskip({ bodyText, mailSubject, pdfAttachments = [] }) {
  console.log('🚢 Eimskip parser gestart');

  const bodyLines = (bodyText || '').split('\n').map(l => l.trim()).filter(Boolean);
  console.log('📋 Eimskip body:\n', bodyLines.map((r, i) => `[${i}] ${r}`).join('\n'));

  // ── Onderwerp (fallback info) ──────────────────────────────────────────
  const sub = mailSubject || '';
  const subContainerM = sub.match(/container\s+([A-Z]{4}\d{7})/i);
  const subContainer   = subContainerM ? subContainerM[1].toUpperCase() : '';
  const subTijdM       = sub.match(/(\d{1,2}:\d{2})\s*uur/i);
  const subTijd        = subTijdM ? subTijdM[1] : '';
  const subDatumM      = sub.match(/(\d{2}-\d{2}-\d{4})/);
  const subDatum       = subDatumM ? parseDatum(subDatumM[1]) : '';

  // ── Zoek de Transportopdracht PDF (prioriteit) ─────────────────────────
  const sortedPdfs = [...pdfAttachments].sort((a, b) => {
    const aTO = /transportopdracht|transport\s*order/i.test(a.filename || '');
    const bTO = /transportopdracht|transport\s*order/i.test(b.filename || '');
    return (bTO ? 1 : 0) - (aTO ? 1 : 0);
  });

  let pdfData = null;
  for (const att of sortedPdfs) {
    if (!att.buffer || !Buffer.isBuffer(att.buffer)) continue;
    try {
      const { text } = await pdfParse(att.buffer);
      const pls = text.split('\n').map(l => l.trim()).filter(Boolean);
      console.log(`📄 Eimskip PDF "${att.filename}" (${pls.length} regels):\n`,
        pls.slice(0, 55).map((r, i) => `[${i}] ${r}`).join('\n'));

      // Herken transportopdracht
      const isTO = /transportopdracht|transport\s*(order|opdracht)/i.test(att.filename || '') ||
                   pls.some(l => /^transport\s*(order|opdracht)/i.test(l));
      if (isTO && pls.length > 10) {
        pdfData = parsePDFLines(pls);
        if (pdfData.containernummer) break;  // PDF succesvol geparsed
      }
    } catch (e) {
      console.warn(`⚠️ Kon PDF "${att.filename}" niet parsen:`, e.message);
    }
  }

  // ── Bouw container data ────────────────────────────────────────────────
  const containernummer = pdfData?.containernummer || subContainer;
  const datum           = pdfData?.sec2?.datum     || subDatum;
  const tijd            = pdfData?.sec2?.tijd      || subTijd;
  const zegel           = pdfData?.zegel           || '';
  const bootnaam        = pdfData?.bootnaam        || '';
  const rederij         = pdfData?.rederij         || 'EIMSKIP';
  const laadreferentie  = pdfData?.laadreferentie  || '';
  const ritnummer       = pdfData?.ritnummer       || '';
  const lading          = pdfData?.lading          || '';
  const brutogewicht    = pdfData?.brutogewicht    || '0';
  const colli           = pdfData?.colli           || '0';

  // Containertype: van ISO code naar EasyTrip-omschrijving
  const isoCode            = pdfData?.containertypeIso || '';
  const containertypeOms   = (isoCode ? (ISO_TYPE[isoCode] || isoCode.toLowerCase()) : '');

  // Locatie-data uit secties
  const lossenRaw  = pdfData?.sec2  || extractAdresUitBody(bodyLines);
  const opzetRaw   = pdfData?.sec1;
  const afzetRaw   = pdfData?.sec3;

  // ── Lookups ────────────────────────────────────────────────────────────
  const lossenZoekNaam  = lossenRaw?.naam  || '';
  const lossenZoekAdres = lossenRaw?.adres || '';

  const [opdrachtgever, lossenInfo, opzettenInfo, afzettenInfo] = await Promise.all([
    getKlantData('eimskip'),
    lossenRaw ? getAdresboekEntry(lossenZoekNaam, null, lossenZoekAdres) : Promise.resolve(null),
    opzetRaw  ? getTerminalInfoMetFallback(opzetRaw.naam, opzetRaw.adres) : Promise.resolve(null),
    afzetRaw  ? getTerminalInfoMetFallback(afzetRaw.naam, afzetRaw.adres) : Promise.resolve(null)
  ]);

  const klantnaam     = lossenInfo?.naam     || lossenRaw?.naam     || '';
  const klantadres    = lossenInfo?.adres    || lossenRaw?.adres    || '';
  const klantpostcode = lossenInfo?.postcode || lossenRaw?.postcode || '';
  const klantplaats   = lossenInfo?.plaats   || lossenRaw?.plaats   || '';
  const klantland     = lossenInfo?.land     || lossenRaw?.land     || 'BE';

  function cleanFloat(v) { return v ? String(v).replace(/\.0+$/, '') : ''; }

  // ── Locaties ───────────────────────────────────────────────────────────
  const locaties = [
    // [0] Opzetten
    {
      volgorde: '0', actie: 'Opzetten',
      naam:     opzettenInfo?.naam     || opzetRaw?.naam     || '',
      adres:    opzettenInfo?.adres    || opzetRaw?.adres    || '',
      postcode: opzettenInfo?.postcode || opzetRaw?.postcode || '',
      plaats:   opzettenInfo?.plaats   || opzetRaw?.plaats   || '',
      land:     opzettenInfo?.land     || normLand(opzetRaw?.land) || 'NL',
      voorgemeld:    opzettenInfo ? (opzettenInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar') : 'Onwaar',
      aankomst_verw: datum || '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(opzettenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(opzettenInfo?.bicsCode      || '')
    },
    // [1] Lossen
    {
      volgorde:      '0',
      actie:         'Lossen',
      naam:          klantnaam,
      adres:         klantadres,
      postcode:      klantpostcode,
      plaats:        klantplaats,
      land:          klantland,
      aankomst_verw: datum || '',
      tijslot_van:   tijd  || '',
      tijslot_tm:    ''
    },
    // [2] Afzetten
    {
      volgorde: '0', actie: 'Afzetten',
      naam:     afzettenInfo?.naam     || afzetRaw?.naam     || '',
      adres:    afzettenInfo?.adres    || afzetRaw?.adres    || '',
      postcode: afzettenInfo?.postcode || afzetRaw?.postcode || '',
      plaats:   afzettenInfo?.plaats   || afzetRaw?.plaats   || '',
      land:     afzettenInfo?.land     || normLand(afzetRaw?.land) || 'NL',
      voorgemeld:    afzettenInfo ? (afzettenInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar') : 'Onwaar',
      aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(afzettenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(afzettenInfo?.bicsCode      || '')
    }
  ];

  if (!containertypeOms) {
    console.warn(`⚠️ Containertype niet herkend. ISO code uit PDF: "${isoCode}"`);
  }

  return [{
    ritnummer,
    klantnaam,
    klantadres,
    klantpostcode,
    klantplaats,
    klantland,

    opdrachtgeverNaam:     opdrachtgever?.naam     || 'EIMSKIP JAC. MEISNER',
    opdrachtgeverAdres:    opdrachtgever?.adres    || '',
    opdrachtgeverPostcode: opdrachtgever?.postcode || '',
    opdrachtgeverPlaats:   opdrachtgever?.plaats   || '',
    opdrachtgeverTelefoon: opdrachtgever?.telefoon || '',
    opdrachtgeverEmail:    opdrachtgever?.email    || '',
    opdrachtgeverBTW:      opdrachtgever?.btw      || '',
    opdrachtgeverKVK:      opdrachtgever?.kvk      || '',

    containernummer,
    containertype:          containertypeOms,
    containertypeCode:      isoCode,
    containertypeOmschrijving: containertypeOms,

    datum,
    tijd,
    referentie:        containernummer,
    laadreferentie,
    inleverreferentie: '',
    inleverBestemming: '',

    rederij,
    bootnaam,
    inleverRederij:  rederij,
    inleverBootnaam: bootnaam,

    zegel,
    colli,
    lading,
    brutogewicht,
    geladenGewicht: brutogewicht,
    cbm:            '0',

    adr:           'Onwaar',
    ladenOfLossen: 'Lossen',
    instructies:   '',
    tar: '', documentatie: '', tarra: '0', brix: '0',

    locaties
  }];
}
