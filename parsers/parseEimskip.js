// parsers/parseEimskip.js
// Eimskip "Transportopdracht" PDF parser
// Digitale PDF  → pdf-parse → parsePDFLines (regex op vaste opmaak)
// Gescande PDF  → Claude Vision → directe JSON-extractie (één API call, geen regex)
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
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
  "ritnummer":        "het opdrachtnummer / referentienummer (ALLEEN cijfers, bijv. '120563')",
  "laadreferentie":   "volledige referentieregel met beide nummers (bijv. '120563 - 520483')",
  "bootnaam":         "naam van het schip / vessel name",
  "rederij":          "VERKORTE naam van de rederij — gebruik altijd de afkorting: MSC, MAERSK, CMA CGM, HAPAG-LLOYD, EVERGREEN, COSCO, ONE, YANG MING, ZIM, PIL — NOOIT de volledige juridische naam",
  "containernummer":  "containernummer EXACT formaat: 4 hoofdletters + 7 cijfers aaneengesloten (bijv. TCLU5199341)",
  "containertypeIso": "4-karakter ISO containercode naast het containernummer (bijv. 22G1=20ft std, 42G1=40ft std, 45G1=40ft HC, 42R1=40ft reefer)",
  "zegel":            "zegelnummer / seal number",
  "lading":           "goederenomschrijving (bijv. CT, STL, machinery)",
  "colli":            "aantal colli als string (bijv. '61')",
  "brutogewicht":     "gewicht in kg als string zonder eenheid (bijv. '5410')",
  "sec1": {
    "naam":     "ALLEEN de naam van de afhaal-/opzetterminal, ZONDER datum of tijd (bijv. 'ECT Delta', 'Euromax Terminal')",
    "datum":    "ophaaldatum formaat D-M-YYYY (bijv. 2-5-2026)",
    "tijd":     "ophaaltijdstip HH:MM of leeg",
    "adres":    "straatnaam + huisnummer",
    "postcode": "postcode",
    "plaats":   "plaatsnaam",
    "land":     "2-letter landcode: NL, BE, DE, GB, FR"
  },
  "sec2": {
    "naam":     "ALLEEN de naam van het bedrijf / klant op het afleveradres, ZONDER datum of tijd",
    "datum":    "afleverdatum formaat D-M-YYYY (bijv. 1-5-2026)",
    "tijd":     "aflevertime HH:MM (bijv. '14:00') of leeg",
    "adres":    "straatnaam + huisnummer",
    "postcode": "postcode",
    "plaats":   "plaatsnaam",
    "land":     "2-letter landcode"
  },
  "sec3": {
    "naam":     "ALLEEN de naam van de afzetterminal / leeg depot, ZONDER datum of tijd",
    "datum":    "datum formaat D-M-YYYY of leeg",
    "tijd":     "tijdstip HH:MM of leeg",
    "adres":    "straatnaam + huisnummer of leeg",
    "postcode": "postcode of leeg",
    "plaats":   "plaatsnaam of leeg",
    "land":     "2-letter landcode: NL, BE, DE"
  }
}

Strikte regels:
- Gebruik lege string "" voor ontbrekende velden, NOOIT null of undefined
- naam-velden: ALLEEN de bedrijfs-/terminalnaam, datum en tijd NOOIT toevoegen aan naam
- naam-velden: NOOIT een getal of '0' als waarde — als de naam niet leesbaar is gebruik lege string ""
- containernummer: aaneengesloten, geen spaties (TCLU5199341 niet TCLU 519 9341)
- ritnummer: ALLEEN het getal, geen tekst of zinnen
- datum formaat: D-M-YYYY zonder voorloopnullen (1-5-2026 niet 01-05-2026)
- rederij: altijd verkorte handelsnaam, nooit de volledige juridische naam
- brutogewicht: ALLEEN het getal zonder decimalen (5410 niet 5410.00)
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

  // Saniteer naam-velden: puur numerieke waarden of '0' worden lege string
  // (Claude geeft soms een getal terug als de naam niet leesbaar is)
  const sanitizeNaam = (v) => (!v || /^\d+$/.test(String(v).trim())) ? '' : String(v).trim();
  if (data.sec1) data.sec1.naam = sanitizeNaam(data.sec1.naam);
  if (data.sec2) data.sec2.naam = sanitizeNaam(data.sec2.naam);
  if (data.sec3) data.sec3.naam = sanitizeNaam(data.sec3.naam);

  console.log(`✅ Claude extractie: container=${data.containernummer} type=${data.containertypeIso} klant="${data.sec2?.naam}"`);
  return data;
}

// Fallback: naam + adres uit email body (na "leveren bij/in/op/te NAAM:" of "leveren:")
// Structuur in Eimskip-mail:
//   Leveren bij:          ← trigger  (of "Leveren bij XYZ BV:" dan zit naam in trigger)
//   COMPANY NAME          ← naam     (als niet in trigger)
//   Straatnaam 12         ← adres
//   1234 AB Rotterdam     ← postcode + stad
//   Netherlands           ← land (optioneel)
function extractAdresUitBody(lines) {
  const trigIdx = lines.findIndex(l => l.endsWith(':') && /leveren/i.test(l));
  if (trigIdx < 0) return null;

  // Probeer naam uit de trigger-regel zelf te halen:
  // bijv. "Gelieve te leveren bij XYZ B.V.:" → "XYZ B.V."
  const trigLine      = lines[trigIdx] || '';
  const naamUitTrigger = trigLine
    .replace(/:$/, '')
    .replace(/^.*?leveren\s+(?:bij|op|in|te|aan)\s*/i, '')
    .trim();

  // Verzamel tot 5 regels na trigger
  const bl = [];
  for (let i = trigIdx + 1; i < lines.length && bl.length < 5; i++) {
    if (lines[i].trim()) bl.push(lines[i].trim());
  }
  if (bl.length < 1) return null;

  // Detecteer of een regel een straatadres is (bevat huisnummer zoals "Straat 12")
  const isAdresRegel = (s) => /\b\d+\b/.test(s) && /[A-Za-z]{3}/.test(s) && /\s\d/.test(s);

  let naam = '', adres = '', pcStad = '', landRaw = '';

  if (naamUitTrigger.length > 2) {
    // Naam staat in de trigger-regel zelf
    naam    = naamUitTrigger;
    adres   = bl[0] || '';
    pcStad  = bl[1] || '';
    landRaw = bl[2] || '';
  } else if (bl[0] && !isAdresRegel(bl[0])) {
    // Eerste regel na trigger is geen adres → bedrijfsnaam
    naam    = bl[0];
    adres   = bl[1] || '';
    pcStad  = bl[2] || '';
    landRaw = bl[3] || '';
  } else {
    // Geen naam gevonden — adres begint direct
    naam    = '';
    adres   = bl[0];
    pcStad  = bl[1] || '';
    landRaw = bl[2] || '';
  }

  if (!adres && !pcStad) return null;
  const { postcode, plaats } = parsePostcodeStad(pcStad);
  console.log(`📬 Body-extractie: naam="${naam}" adres="${adres}" pc="${postcode}" plaats="${plaats}"`);
  return { naam, adres, postcode, plaats, land: normLand(landRaw) || 'BE' };
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

    // CMR-documenten overslaan — dit zijn vrachtbrieven, geen transportopdrachten
    if (/\bCMR\b/i.test(att.filename || '')) {
      console.log(`⏭️ CMR-document overgeslagen: ${att.filename}`);
      continue;
    }

    try {
      // Probeer digitale tekstextractie
      let text = '';
      try {
        const parsed = await pdfParse(att.buffer);
        text = parsed.text || '';
      } catch (e) {
        console.warn(`⚠️ pdf-parse fout voor "${att.filename}":`, e.message);
      }

      const isGescand = text.trim().length < 80;
      console.log(`📄 Eimskip PDF "${att.filename}" (${text.trim().length} tekens${isGescand ? ' → GESCAND' : ''})`);

      if (isGescand) {
        // Gescande PDF: één Claude-call, directe JSON → geen parsePDFLines nodig
        console.log('🖼️ Gescande PDF → Claude structured JSON extractie');
        pdfData = await extractEimskipJsonFromPdf(att.buffer);
        if (pdfData?.containernummer) break;
        console.warn('⚠️ Claude extractie leverde geen containernummer op');
        pdfData = null;
        continue;
      }

      // Digitale PDF: gebruik regex-parser
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
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
  // Gewicht: verwijder decimalen (Claude geeft soms "5410.00")
  const rawGewicht       = pdfData?.brutogewicht    || '0';
  const brutogewicht     = String(Math.round(parseFloat(rawGewicht.replace(',', '.')) || 0));
  const colli            = pdfData?.colli           || '0';

  // Containertype: van ISO code naar EasyTrip-omschrijving
  const isoCode          = pdfData?.containertypeIso || '';
  const containertypeOms = isoCode ? (ISO_TYPE[isoCode] || isoCode.toLowerCase()) : '';

  if (!containertypeOms) {
    console.warn(`⚠️ Containertype niet herkend. ISO code uit PDF: "${isoCode}"`);
  }

  // Locatie-data uit secties
  // sec2 heeft prioriteit; als de naam ontbreekt na OCR → vul aan vanuit email-body
  const bodyAdres  = extractAdresUitBody(bodyLines);
  const sec2Raw    = pdfData?.sec2 || null;
  const lossenRaw  = sec2Raw
    ? { ...sec2Raw, naam: sec2Raw.naam || bodyAdres?.naam || '' }
    : (bodyAdres || null);
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
    inleverBestemming: afzetRaw?.naam || '',

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
