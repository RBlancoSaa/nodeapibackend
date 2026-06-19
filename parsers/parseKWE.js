// parsers/parseKWE.js
// KWE (Kintetsu World Express Benelux) import-orders — vrije e-mail-tekst.
// De transportdata staat in de e-mail-BODY; PDF-bijlagen zijn release-documenten
// (soms staat het containernummer erin). Geport + verbeterd vanuit AHQ kwe.ts,
// in nodeapi-vorm (enrichOrder, DD-MM-YYYY, nodeapi-veldnamen).
//
// Aanroep:
//   parseKWE({ bodyText, mailSubject, pdfAttachments })   ← Gmail-flow (handleKWE)
//   parseKWE({ buffer })                                  ← dropbox (PDF-tekst als body)
import '../utils/fsPatch.js';
import { extractPdfText } from '../utils/ocrPdf.js';
import { enrichOrder } from '../utils/enrichOrder.js';

function parseDatumNL(str) {
  // "07-05-2026", "07-05", "07.05.2026" — met validatie (dag 1-31, maand 1-12)
  const m = (str || '').match(/(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{4}))?/);
  if (!m) return '';
  const dagNum = Number(m[1]);
  const mndNum = Number(m[2]);
  if (!Number.isFinite(dagNum) || !Number.isFinite(mndNum)) return '';
  if (dagNum < 1 || dagNum > 31) return '';
  if (mndNum < 1 || mndNum > 12) return '';
  const jaar = m[3] || String(new Date().getFullYear());
  return `${String(dagNum).padStart(2, '0')}-${String(mndNum).padStart(2, '0')}-${jaar}`;
}

function normalizeContainerType(raw) {
  const r = (raw || '').toUpperCase().replace(/\s+/g, '');
  const isHC = /HC|HQ|HIGHCUBE/.test(r);
  if (/45/.test(r)) return isHC ? '45ft HC' : '45ft';
  if (/20/.test(r)) return isHC ? '20ft HC' : '20ft';
  return isHC ? '40ft HC' : '40ft'; // default 40
}

/** Haal regels op na een label-regel tot de volgende sectie of max N regels. */
function getBlock(lines, labelRe, maxLines = 6) {
  const idx = lines.findIndex(l => labelRe.test(l));
  if (idx < 0) return [];
  const block = [];
  for (let i = idx + 1; i < Math.min(idx + 1 + maxLines, lines.length); i++) {
    if (/^[A-Za-zÀ-ɏ][^\n]{0,35}:\s*$/.test(lines[i] || '')) break;
    if (lines[i]) block.push(lines[i]);
  }
  return block;
}

export default async function parseKWE({ bodyText = '', mailSubject = '', pdfAttachments = [], buffer = null } = {}) {
  // Dropbox-pad: alleen een PDF-buffer → gebruik de PDF-tekst als "body".
  // (KWE-data zit normaal in de mail-body; een losse release-PDF levert hooguit
  // het containernummer op, maar zo crasht de dropbox tenminste niet.)
  if (!bodyText && buffer && Buffer.isBuffer(buffer)) {
    try {
      const { text } = await extractPdfText(buffer, 'KWE document');
      bodyText = text || '';
    } catch { /* onleesbaar — laat body leeg */ }
  }

  const body    = (bodyText || '').replace(/\r\n/g, '\n');
  const subject = mailSubject || '';
  const lines   = body.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Order-vs-conversatie guard (uit AHQ) ──────────────────────────────────
  // KWE-subjects dragen "Transportopdracht …" mee in replies/vragen. Een ECHTE
  // order heeft order-markers; een vraag/reply zonder enige order-marker is geen
  // opdracht → geen rit (voorkomt spookritten met afzet="VOLGT NOG." e.d.).
  const bodyKop = body.slice(0, 700);
  const heeftOrderMarker =
    /\b[A-Z]{4}\d{7}\b/.test(body) ||
    /\b(afhal\w*|laden|aanleveren|leveren|leeg\s*retour|boot\s*[:\-]|vessel\s*[:\-]|release|wegvoering|pin[\s-]*nummer|turn[\s-]*in\s*ref)\b/i.test(body);
  const heeftConversatieMarker =
    /\?|onderstaand\s+antwoord|antwoord\s+van\s+klant|nogmaals|is\s+akkoord|bedankt\s+voor|hoor\s+het\s+graag|gaat\s+het.{0,25}lukken|graag.{0,40}nakijken|klopt.{0,15}niet/i.test(bodyKop);
  if (!heeftOrderMarker && heeftConversatieMarker) {
    console.warn('⚠️ KWE: conversatie/vraag zonder order-marker — geen order');
    return [];
  }

  // ── Ritnummer ──
  let ritnummer = '';
  const refBodyMatch = body.match(/(?:onze\s+referentie[^:\n]{0,30}|KWE\s+ref\s*[# ]*)\s*[:\-]\s*([A-Z0-9]{6,})/i);
  if (refBodyMatch) ritnummer = refBodyMatch[1].trim();
  if (!ritnummer) {
    // Subject: laatste "/"-segment dat (ná strippen van 'KWE ref #') enkel een
    // alfanumeriek nummer is.
    const subParts = subject.split('/').map(s => s.trim());
    for (const p of [...subParts].reverse()) {
      const cleaned = p.replace(/KWE\s*ref\s*[#:\-]*/i, '').replace(/[\s#]/g, '');
      if (/^[A-Z0-9]{6,}$/i.test(cleaned)) { ritnummer = cleaned; break; }
    }
  }

  // ── Container type & count ──
  const ctMatch = (subject + ' ' + body).match(/(\d+)\s*[xX]\s*(\d+)\s*(?:ft|FT)?\s*(HC|HQ|high[\s\-]?cube|\bHC\b)?/i);
  const containerCount = ctMatch ? parseInt(ctMatch[1], 10) : 1;
  const containertype  = ctMatch ? normalizeContainerType(`${ctMatch[2]}${ctMatch[3] || ''}`) : '40ft';

  // ── Terminal (Afhalen bij:) ──
  const afhalenBlock = getBlock(lines, /^afhalen\s+bij\s*:/i, 3);
  let terminalRaw = afhalenBlock[0] || '';

  // ── Klant (Aanleveren bij:) ──
  const aanlevBijBlock = getBlock(lines, /^aanleveren\s+bij\s*:/i, 8);
  let klantNaam = '', klantAdres = '', klantPC = '', klantPlaats = '', klantLand = 'NL';
  if (aanlevBijBlock.length > 0) {
    const pcIdx = aanlevBijBlock.findIndex(l => /^\d{4}\s*[A-Z]{2}/i.test(l));
    if (pcIdx >= 0) {
      const pcM  = aanlevBijBlock[pcIdx].match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
      klantPC    = pcM ? `${pcM[1]} ${pcM[2]}` : '';
      klantPlaats = pcM ? pcM[3].split(',')[0].trim() : '';
      klantNaam  = aanlevBijBlock[0] || '';
      klantAdres = aanlevBijBlock[1] || '';
      const landRegel = aanlevBijBlock[pcIdx + 1] || '';
      klantLand  = /netherlands|nederland/i.test(landRegel) ? 'NL' : (landRegel.trim().slice(0, 2).toUpperCase() || 'NL');
    } else {
      klantNaam  = aanlevBijBlock[0] || '';
      klantPlaats = aanlevBijBlock[1] || '';
    }
  }

  // ── Subject-route fallback (uit AHQ) ──
  // "... / Transportopdracht Rotterdam - Standaardbuiten / 6x 40hc / ..."
  const routeM = subject.match(/Transportopdracht\s+([A-Za-z\s]+?)\s*-\s*([A-Za-z\s]+?)\s*\//i);
  if (routeM) {
    const opzetRegio = routeM[1].trim();
    const losPlaats  = routeM[2].trim();
    if (!terminalRaw && opzetRegio) terminalRaw = opzetRegio;
    if (!klantPlaats && losPlaats)  klantPlaats = losPlaats;
  }

  // ── Datum ──
  let datum = '';
  const aanlevSchema = body.match(/Aanleveren\s*:\s*\n([\s\S]{0,200}?)(?:\n\n|\n[A-Z])/i);
  if (aanlevSchema) {
    const datumM = aanlevSchema[1].match(/(\d{1,2}[.\-\/]\d{1,2}(?:[.\-\/]\d{4})?)/);
    if (datumM) datum = parseDatumNL(datumM[1]);
  }
  if (!datum) {
    const datumM = (subject + ' ' + body).match(/\b(\d{1,2}[.\-]\d{1,2}(?:[.\-]\d{4})?)\b/);
    if (datumM) datum = parseDatumNL(datumM[1]);
  }

  // ── Scheepsnaam ──
  const bootMatch = body.match(/(?:Boot|Vessel|Schip)\s*[:\-]\s*(.+?)(?:\n|\.)/i);
  const bootnaam  = bootMatch ? bootMatch[1].trim().replace(/\s*[.,]$/, '') : '';

  // ── Containernummer uit release-PDF(s) (best-effort, uit AHQ) ──
  let containernummer = '';
  for (const pdf of (pdfAttachments || [])) {
    if (containernummer) break;
    if (!pdf?.buffer || !Buffer.isBuffer(pdf.buffer) || pdf.buffer.length < 100) continue;
    try {
      const { text } = await extractPdfText(pdf.buffer, 'KWE release');
      const cnM = (text || '').match(/\b([A-Z]{3}U\d{7})\b/);
      if (cnM) containernummer = cnM[1].toUpperCase();
    } catch { /* release-PDF onleesbaar — negeren */ }
  }

  // ── Alternatief body-formaat (uit AHQ) ──
  //   Laden:  RWG / LEVEREN: NEDCARGO , WADDINXVEEN
  //   KOCU4597056// A264031605 // 04-06-2026 om 13.00U / Leeg retour RWG
  let pinRef = '', leegRetour = '', tijd = '', turnInRef = '';
  if (!terminalRaw) {
    const ladM = body.match(/^\s*Laden+\s*:?\s*([A-Za-z0-9][A-Za-z0-9 .&\-]{0,40})/im) || body.match(/\bEx\s+([A-Z]{2,5})\b/);
    if (ladM) terminalRaw = ladM[1].trim();
  }
  if (!klantNaam && !klantPlaats) {
    const levM = body.match(/^\s*LEVEREN\s*:?\s*(.+)$/im);
    if (levM) {
      const delen = levM[1].split(',').map(s => s.trim()).filter(Boolean);
      klantNaam  = delen[0] || '';
      klantPlaats = delen[1] || '';
    }
  }
  {
    const cntrLine = lines.find(l => /\b[A-Z]{4}\d{7}\b/.test(l)) || '';
    if (!containernummer) {
      const cnM = cntrLine.match(/\b([A-Z]{4}\d{7})\b/);
      if (cnM) containernummer = cnM[1].toUpperCase();
    }
    const pinM = cntrLine.match(/\/\/\s*([A-Z0-9]{5,})/);
    if (pinM) pinRef = pinM[1];
    if (!datum) {
      const dM = cntrLine.match(/(\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{4})/);
      if (dM) datum = parseDatumNL(dM[1].replace(/\s+/g, ''));
    }
    const tM = cntrLine.match(/om\s*(\d{1,2})[.:](\d{2})/i);
    if (tM) tijd = `${tM[1].padStart(2, '0')}:${tM[2]}:00`;
  }
  const lrM = body.match(/Leeg\s+retour\s*:?\s*([A-Za-z0-9][A-Za-z0-9 .&\-]{0,40})/i);
  if (lrM) leegRetour = lrM[1].trim();
  const tirM = body.match(/Turn[\s\-]*In\s*Ref\.?[\s:\-]*\n?\s*([A-Z0-9]{6,})/i) || body.match(/\b(JOTR[A-Z0-9]+)\b/);
  if (tirM) turnInRef = tirM[1];

  // ── Instructies ──
  const instrParts = [`${containerCount}x ${containertype}`];
  if (aanlevSchema) {
    const schema = aanlevSchema[1].trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (schema.length > 0) instrParts.push(schema.join(' | '));
  }
  const telMatch = body.match(/bellen\s+naar\s*[:\-]\s*([^\n,]{4,20})/i);
  if (telMatch) instrParts.push(`Bellen: ${telMatch[1].trim()}`);
  const etaMatch = body.match(/ETA[^:\n]{0,20}:\s*([^\n]+)/i);
  if (etaMatch) instrParts.push(`ETA: ${etaMatch[1].trim()}`);
  if (leegRetour) instrParts.push(`Leeg retour: ${leegRetour}`);
  const instructies = instrParts.filter(Boolean).join(' | ');

  console.log(`🔍 KWE: ritnummer="${ritnummer}" ${containerCount}× ${containertype} | terminal="${terminalRaw}" datum="${datum}" klant="${klantNaam}" boot="${bootnaam}"`);

  // Onvoldoende data → geen order
  if (!ritnummer && !klantNaam && !terminalRaw && !bootnaam) {
    console.warn('⚠️ KWE: geen bruikbare body/release-data — geen order');
    return [];
  }

  const order = await enrichOrder({
    ritnummer,
    klantnaam:     klantNaam,
    klantadres:    klantAdres,
    klantpostcode: klantPC,
    klantplaats:   klantPlaats,

    opdrachtgeverNaam:     'KINTETSU IMP WORLD EXPRESS (BENELUX) KWEI',
    opdrachtgeverAdres:    'RIDDERHAVEN 12',
    opdrachtgeverPostcode: '2980 AE',
    opdrachtgeverPlaats:   'RIDDERKERK',
    opdrachtgeverTelefoon: '',
    opdrachtgeverEmail:    '',
    opdrachtgeverBTW:      'NL800039233B01',
    opdrachtgeverKVK:      '34072948',

    containernummer: containernummer || '',
    containertype,

    datum,
    tijd,
    // klant_ref = KWE-ref; opzet-PIN = pinRef; inlever-ref bij afzet = Turn-In-Ref
    referentie:        pinRef || ritnummer,
    laadreferentie:    '',
    inleverreferentie: turnInRef || '',
    inleverBestemming: '',

    // Rederij uit de container-eigenaarsprefix (BIC owner code = eerste 4 tekens);
    // enrichOrder valideert via de rederijen-lijst → onbekend prefix blijft leeg.
    rederijRaw:      containernummer ? containernummer.slice(0, 4) : '',
    rederij:         '',
    bootnaam,
    inleverBootnaam: bootnaam,
    inleverRederij:  '',

    zegel:          '',
    colli:          '0',
    lading:         '',
    brutogewicht:   '0',
    geladenGewicht: '0',
    cbm:            '0',

    adr:           'Onwaar',
    ladenOfLossen: 'Lossen',
    _ladenOfLossenFixed: true,
    instructies,
    tar: '', documentatie: '', tarra: '0', brix: '0',

    locaties: [
      { volgorde: '0', actie: 'Opzetten', naam: terminalRaw, adres: '', postcode: '', plaats: '', land: 'NL' },
      { volgorde: '0', actie: 'Lossen',   naam: klantNaam, adres: klantAdres, postcode: klantPC, plaats: klantPlaats, land: klantLand },
      { volgorde: '0', actie: 'Afzetten', naam: leegRetour, adres: '', postcode: '', plaats: '', land: 'NL',
        ...(leegRetour ? {} : { _noTerminalLookup: true }) },
    ],
  }, { bron: 'KWE' });

  return [order];
}
