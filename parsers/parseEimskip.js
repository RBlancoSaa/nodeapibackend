// parsers/parseEimskip.js
// Eimskip "Transportopdracht" PDF parser
// Digitale PDF  → pdf-parse → parsePDFLines (regex op vaste opmaak)
// Gescande PDF  → Claude Vision → directe JSON-extractie (geen regex nodig)
import '../utils/fsPatch.js';
import { extractPdfText } from '../utils/ocrPdf.js';
import Anthropic from '@anthropic-ai/sdk';
import { enrichOrder } from '../utils/enrichOrder.js';

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


// ── Claude: directe JSON-extractie uit gescande Eimskip-PDF ──────────────
// Gebruikt Claude Vision met een Eimskip-specifieke prompt.
// Geeft exact dezelfde structuur terug als parsePDFLines().
async function extractEimskipJsonFromPdf(pdfBuffer) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ontbreekt');

  const client = new Anthropic({ apiKey });
  const b64    = pdfBuffer.toString('base64');

  const prompt = `Dit is een gescande Eimskip transportopdracht (Nederlands/Engels).
Lees alle velden zorgvuldig en geef ze terug als GELDIGE JSON. Geen extra tekst, alleen JSON.

Verplichte structuur:
{
  "ritnummer":        "eerste referentienummer (bijv. 120563)",
  "laadreferentie":   "volledige referentieregel (bijv. '120563 - 520483')",
  "bootnaam":         "naam van het schip / vessel",
  "rederij":          "naam van de rederij / carrier (bijv. MAERSK, MSC, CMA CGM)",
  "containernummer":  "containernummer EXACT formaat: 4 hoofdletters + 7 cijfers (bijv. TCLU5199341)",
  "containertypeIso": "4-karakter ISO containercode (bijv. 22G1=20ft, 42G1=40ft, 45G1=40ftHC, 42R1=40ft reefer)",
  "zegel":            "zegelnummer / seal number",
  "lading":           "goederenomschrijving (bijv. CT, STL, machinery)",
  "colli":            "aantal colli als string (bijv. '61')",
  "brutogewicht":     "gewicht in kg als string zonder eenheid (bijv. '5410')",
  "sec1": {
    "naam":     "naam van de afhaal-/opzetterminal (bijv. ECT Delta, Euromax)",
    "datum":    "datum formaat D-M-YYYY (bijv. 2-5-2026)",
    "tijd":     "tijdstip HH:MM of leeg",
    "adres":    "straatnaam + huisnummer",
    "postcode": "postcode",
    "plaats":   "plaatsnaam",
    "land":     "2-letter landcode: NL, BE, DE, GB, FR"
  },
  "sec2": {
    "naam":     "naam van het afleveradres / klant / bedrijf",
    "datum":    "afleverdatum formaat D-M-YYYY",
    "tijd":     "aflevertime HH:MM of leeg",
    "adres":    "straatnaam + huisnummer",
    "postcode": "postcode",
    "plaats":   "plaatsnaam",
    "land":     "2-letter landcode"
  },
  "sec3": {
    "naam":     "naam van de afzettterminal / depot",
    "datum":    "datum formaat D-M-YYYY of leeg",
    "tijd":     "tijdstip HH:MM of leeg",
    "adres":    "straatnaam + huisnummer of leeg",
    "postcode": "postcode of leeg",
    "plaats":   "plaatsnaam of leeg",
    "land":     "2-letter landcode: NL, BE, DE"
  }
}

Regels:
- Gebruik lege string "" voor ontbrekende velden, nooit null of undefined
- containernummer: ALTIJD 4 hoofdletters + 7 cijfers aaneengesloten (TCLU5199341 niet TCLU 519 9341)
- containertypeIso: kijk naar ISO-code tussen haakjes naast het containernummer, of leid af uit omschrijving
- datum formaat: dag-maand-jaar zonder voorloopnullen (2-5-2026 niet 02-05-2026)
- Geef ALLEEN geldige JSON terug, geen uitleg, geen markdown-backticks`;

  const message = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const raw = (message.content[0]?.text || '').trim();
  console.log('🤖 Claude Eimskip OCR:\n', raw.slice(0, 800));

  // Strip eventuele markdown code-fences
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const data    = JSON.parse(jsonStr);

  console.log(`✅ Claude extractie: container=${data.containernummer} type=${data.containertypeIso} klant="${data.sec2?.naam}"`);
  return data;
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
      const { lines, wasOcr } = await extractPdfText(att.buffer, 'Eimskip transportopdracht');
      console.log(`📄 Eimskip PDF "${att.filename}" (${lines.length} regels${wasOcr ? ', GESCAND' : ''})`);

      if (wasOcr) {
        // Gescande PDF: gebruik Claude structured extraction — geen regex op OCR-tekst
        console.log('🖼️ Gescande PDF → Claude structured JSON extractie');
        pdfData = await extractEimskipJsonFromPdf(att.buffer);
        if (pdfData?.containernummer) break;
        console.warn('⚠️ Claude extractie leverde geen containernummer op');
        pdfData = null;
        continue;
      }

      // Digitale PDF: gebruik bestaande regex-parser
      const isTO = /transportopdracht|transport\s*(order|opdracht)/i.test(att.filename || '') ||
                   lines.some(l => /^transport\s*(order|opdracht)/i.test(l));
      if (isTO && lines.length > 10) {
        console.log(`📋 Regels:\n`, lines.slice(0, 55).map((r, i) => `[${i}] ${r}`).join('\n'));
        pdfData = parsePDFLines(lines);
        if (pdfData.containernummer) break;
      }
    } catch (e) {
      console.warn(`⚠️ Kon PDF "${att.filename}" niet parsen:`, e.message);
    }
  }

  // ── Bouw container data ────────────────────────────────────────────────
  const containernummer  = pdfData?.containernummer || subContainer;
  const datum            = pdfData?.sec2?.datum     || subDatum;
  const tijd             = pdfData?.sec2?.tijd      || subTijd;
  const zegel            = pdfData?.zegel           || '';
  const bootnaam         = pdfData?.bootnaam        || '';
  const rederijRaw       = pdfData?.rederij         || 'EIMSKIP';
  const laadreferentie   = pdfData?.laadreferentie  || '';
  const ritnummer        = pdfData?.ritnummer       || '';
  const lading           = pdfData?.lading          || '';
  const brutogewicht     = pdfData?.brutogewicht    || '0';
  const colli            = pdfData?.colli           || '0';

  // Containertype: van ISO code naar EasyTrip-omschrijving
  const isoCode          = pdfData?.containertypeIso || '';
  const containertypeOms = isoCode ? (ISO_TYPE[isoCode] || isoCode.toLowerCase()) : '';

  if (!containertypeOms) {
    console.warn(`⚠️ Containertype niet herkend. ISO code uit PDF: "${isoCode}"`);
  }

  // Locatie-data uit secties
  const lossenRaw = pdfData?.sec2 || extractAdresUitBody(bodyLines);
  const opzetRaw  = pdfData?.sec1;
  const afzetRaw  = pdfData?.sec3;

  // Ruwe locaties — enrichOrder doet alle lookups
  const locaties = [
    {
      volgorde: '0', actie: 'Opzetten',
      naam:     opzetRaw?.naam     || '',
      adres:    opzetRaw?.adres    || '',
      postcode: opzetRaw?.postcode || '',
      plaats:   opzetRaw?.plaats   || '',
      land:     normLand(opzetRaw?.land || 'NL')
    },
    {
      volgorde: '0', actie: 'Lossen',
      naam:     lossenRaw?.naam     || '',
      adres:    lossenRaw?.adres    || '',
      postcode: lossenRaw?.postcode || '',
      plaats:   lossenRaw?.plaats   || '',
      land:     normLand(lossenRaw?.land || 'BE')
    },
    {
      volgorde: '0', actie: 'Afzetten',
      naam:     afzetRaw?.naam     || '',
      adres:    afzetRaw?.adres    || '',
      postcode: afzetRaw?.postcode || '',
      plaats:   afzetRaw?.plaats   || '',
      land:     normLand(afzetRaw?.land || 'NL')
    }
  ];

  return [await enrichOrder({
    ritnummer,
    klantnaam:     lossenRaw?.naam     || '',
    klantadres:    lossenRaw?.adres    || '',
    klantpostcode: lossenRaw?.postcode || '',
    klantplaats:   lossenRaw?.plaats   || '',

    // Opdrachtgever: voeg Eimskip toe in klanten.json voor volledige KVK/BTW/adres-gegevens
    opdrachtgeverNaam:     'EIMSKIP JAC. MEISNER CUSTOMS & WAREHOUSING B.V.',
    opdrachtgeverAdres:    '',
    opdrachtgeverPostcode: '',
    opdrachtgeverPlaats:   '',
    opdrachtgeverTelefoon: '+31 10 269 1514',
    opdrachtgeverEmail:    '',
    opdrachtgeverBTW:      '',
    opdrachtgeverKVK:      '',

    containernummer,
    containertype:    containertypeOms,
    containertypeCode: isoCode,

    datum,
    tijd,
    referentie:        containernummer,
    laadreferentie,
    inleverreferentie: '',
    inleverBestemming: '',

    rederijRaw,
    rederij:         '',
    bootnaam,
    inleverBootnaam: bootnaam,
    inleverRederij:  '',

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
  }, { bron: 'Eimskip' })];
}
