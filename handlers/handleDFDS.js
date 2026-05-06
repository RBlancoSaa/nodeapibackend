// handlers/handleDFDS.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseDFDS from '../parsers/parseDFDS.js';
import { enrichOrder } from '../utils/enrichOrder.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';

// ── Opdrachtgever-overrides op basis van lading/body-tekst ───────────────────
// Volgorde van specificiteit: eerste match wint.
const DFDS_OPDRACHTGEVER_OVERRIDES = [
  {
    // RADTEC-orders: vaste prijs 285 all-in excl. diesel met DFDS RT ESTRON
    test: text => /radtec/i.test(text),
    data: {
      opdrachtgeverNaam:     'DFDS RT ESTRON',
      opdrachtgeverAdres:    'WOLGAWEG 3',
      opdrachtgeverPostcode: '3198 LR',
      opdrachtgeverPlaats:   'ROTTERDAM',
      opdrachtgeverTelefoon: '+31 103334600',
      opdrachtgeverEmail:    'nl-rtm-invoices@dfds.com',
      opdrachtgeverBTW:      'NL007129099B01',
      opdrachtgeverKVK:      '24232781',
      tarief:                285,   // vaste prijs excl. diesel
    }
  }
];

/** Geeft de opdrachtgever-override als de tekst een bekend patroon bevat, anders null. */
function getDFDSOpdrachtgeverOverride(text) {
  for (const entry of DFDS_OPDRACHTGEVER_OVERRIDES) {
    if (entry.test(text)) return entry.data;
  }
  return null;
}

// ── Body-only order parser ────────────────────────────────────────────────────
// Gebruikt als alle PDF-bijlagen 0 containers opleveren maar de email body
// een SFIM-referentienummer bevat (bijv. pure RADTEC/DG body-orders).
function parseDFDSBodyOrder(bodyText = '', mailSubject = '') {
  const sfimMatch = bodyText.match(/\bSFIM(\d{7})\b/i);
  if (!sfimMatch) return null; // geen SFIM-ref → geen order

  const ritnummer = `SFIM${sfimMatch[1]}`;

  // Lading uit "Type of goods: ..."
  const ladingMatch = bodyText.match(/Type\s+of\s+goods\s*:\s*(.+?)(?:\r?\n|$)/i);
  const lading = (ladingMatch ? ladingMatch[1] : '').trim().toUpperCase();

  // ADR detectie
  const adr = (
    /Dangerous\s+Goods\s*:\s*Yes/i.test(bodyText) ||
    /\bUN\s*\d{4}\b/.test(bodyText) ||
    /\bADR\b/i.test(bodyText)
  ) ? 'Waar' : 'Onwaar';

  // Datum: "Drop-off date ... : DD-MM-YYYY" of "Unloading date ... : DD-MM-YYYY"
  const datumMatch = bodyText.match(/(?:Drop-off|Unloading)\s+date[^:]*:\s*(\d{2}-\d{2}-\d{4})/i);
  const datum = datumMatch ? datumMatch[1] : '';

  // Locatie/dockcode bijv. "DC6"
  const locMatch = bodyText.match(/Drop-off\s+location[^:]*:\s*(.+?)(?:\r?\n|$)/i);
  const locCode = locMatch ? locMatch[1].trim() : '';

  const opdrachtgeverOverride = getDFDSOpdrachtgeverOverride(`${lading} ${bodyText}`);

  const basisOpdrachtgever = {
    opdrachtgeverNaam:     'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
    opdrachtgeverAdres:    'WOLGAWEG 3',
    opdrachtgeverPostcode: '3198 LR',
    opdrachtgeverPlaats:   'ROTTERDAM',
    opdrachtgeverTelefoon: '+31 103334600',
    opdrachtgeverEmail:    'nl-rtm-operations@dfds.com',
    opdrachtgeverBTW:      'NL007129099B01',
    opdrachtgeverKVK:      '24232781',
  };

  const instructiesDelen = [
    locCode ? `Locatie: ${locCode}` : '',
    mailSubject || '',
    '⚠️ Body-order — containernummer ontbreekt'
  ].filter(Boolean);

  return {
    ...(opdrachtgeverOverride || basisOpdrachtgever),
    ritnummer,
    containernummer:   '',
    containertype:     '',
    containertypeCode: '0',
    cbm:               '0',
    zegel:             '',
    colli:             '0',
    lading,
    brutogewicht:      '0',
    geladenGewicht:    '0',
    datum,
    tijd:              '',
    referentie:        ritnummer,
    laadreferentie:    '',
    inleverreferentie: '',
    adr,
    bootnaam:          '',
    rederijRaw:        '',
    rederij:           '',
    inleverBootnaam:   '',
    inleverRederij:    '',
    ladenOfLossen:     'Laden',
    _ladenOfLossenFixed: true,
    instructies:       instructiesDelen.join(' | '),
    tar:               '',
    documentatie:      '',
    tarra:             '0',
    brix:              '0',
    klantnaam:         '',
    klantadres:        '',
    klantpostcode:     '',
    klantplaats:       '',
    locaties: [
      {
        volgorde: '0', actie: 'Opzetten',
        naam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
        adres: 'WOLGAWEG 3', postcode: '3198 LR', plaats: 'ROTTERDAM', land: 'NL',
        _noTerminalLookup: true
      },
      {
        volgorde: '0', actie: 'Laden',
        naam: '', adres: '', postcode: '', plaats: '', land: 'NL'
      },
      {
        volgorde: '0', actie: 'Afzetten',
        naam: 'DFDS MAASVLAKTE WAREHOUSING ROTTERDAM B.V.',
        adres: 'WOLGAWEG 3', postcode: '3198 LR', plaats: 'ROTTERDAM', land: 'NL',
        _noTerminalLookup: true
      }
    ]
  };
}

/**
 * Sorteert een lijst PDFs zodat de echte DFDS-transportorder als eerste geprobeerd wordt.
 * DG-formulieren (IMO/ADR), facturen en booking confirmations zijn bijlagen, geen orders.
 */
function sorteerDFDSPdfs(pdfs) {
  const score = fn => {
    const f = (fn || '').toLowerCase();
    // Echte transportorder = "Logistiek - Transportorder" of "transportorder"
    if (/logistiek.*transport|transport.*order/i.test(f)) return 0;
    // Magazijn-opdracht (S-nummer formaat, PICKUP/LOAD/UNLOAD structuur)
    if (/magazijn.*zending|proforma.*zending/i.test(f)) return 1;
    // Booking confirmation
    if (/booking.*confirm|confirm.*booking/i.test(f)) return 2;
    // DG-formulieren / IMO: bestandsnaam begint vaak met containernummer (EGSU/EMCU/EITU...)
    // of bevat "DG" of heeft een boeking-codenummer als naam (bijv. "DB51G22T1.PDF")
    if (/\bDG\b/i.test(f)) return 10;
    if (/^[A-Z]{4}\d{7}|^[A-Z]{2}\d+[A-Z]\d+\.pdf$/i.test(fn)) return 10;
    return 5; // overige bijlagen
  };
  return [...pdfs].sort((a, b) => score(a.filename) - score(b.filename));
}

export default async function handleDFDS({ buffer, base64, filename, fromEmail = '', bodyText = '', mailSubject = '', getReleaseData = null, allPdfs = null }) {
  console.log(`📦 Verwerken van DFDS-bestand: ${filename}`);

  // Lege buffer = geen echte PDF. Sla over tenzij er allPdfs zijn of de body een SFIM-ref heeft.
  const heeftGeenPdf = !buffer || !Buffer.isBuffer(buffer) || buffer.length === 0;
  const heeftAllPdfs = allPdfs && allPdfs.some(p => p.buffer && Buffer.isBuffer(p.buffer) && p.buffer.length > 0);
  const heeftBodyOrder = bodyText && /\bSFIM\d{7}\b/i.test(bodyText);
  if (heeftGeenPdf && !heeftAllPdfs && !heeftBodyOrder) {
    console.log(`⏭️ DFDS: geen PDF-buffer en geen body-order voor "${filename || '(geen bestand)'}" — overgeslagen`);
    return [];
  }

  // Als er meerdere PDFs zijn (allPdfs), probeer ze in volgorde totdat één containers geeft.
  // De echte transportorder (Logistiek - Transportorder) wordt geprioriteerd boven DG-formulieren.
  // Bij body-only email (geen PDFs) slaan we de PDF-loop over.
  const kandidaten = heeftAllPdfs
    ? sorteerDFDSPdfs(allPdfs)
    : (heeftGeenPdf ? [] : [{ buffer, base64, filename }]);

  let containers = [];
  let gebruiktePdf = { buffer, base64, filename };

  for (const pdf of kandidaten) {
    if (!pdf.buffer || !Buffer.isBuffer(pdf.buffer) || pdf.buffer.length === 0) {
      console.log(`⏭️ DFDS: lege buffer voor "${pdf.filename}" — overgeslagen`);
      continue;
    }
    console.log(`🔍 DFDS: probeer PDF "${pdf.filename}"`);
    try {
      const result = await parseDFDS(pdf.buffer);
      const gevonden = Array.isArray(result) ? result : (result?.containers || []);
      if (gevonden.length > 0) {
        containers = gevonden;
        gebruiktePdf = pdf;
        console.log(`✅ DFDS: ${gevonden.length} container(s) gevonden in "${pdf.filename}"`);
        break;
      } else {
        console.log(`⏭️ DFDS: geen containers in "${pdf.filename}", probeer volgende`);
      }
    } catch (err) {
      console.warn(`⚠️ DFDS: fout bij parsen "${pdf.filename}": ${err.message} — probeer volgende`);
    }
  }

  if (containers.length === 0) {
    // Geen containers uit PDF(s) → probeer email body als fallback
    if (bodyText && /\bSFIM\d{7}\b/i.test(bodyText)) {
      console.log('📋 DFDS: geen PDF-containers — probeer body-order parsing');
      const bodyOrder = parseDFDSBodyOrder(bodyText, mailSubject);
      if (bodyOrder) {
        console.log(`✅ DFDS body-order: ritnummer=${bodyOrder.ritnummer} adr=${bodyOrder.adr}`);
        containers = [await enrichOrder(bodyOrder, { bron: 'DFDS' })];
        gebruiktePdf = { buffer: null, base64: null, filename: mailSubject || 'body-order' };
      }
    }
    if (containers.length === 0) {
      console.warn('⚠️ Geen DFDS containers geparsed (alle PDFs geprobeerd + geen body-order)');
      return [];
    }
  }

  // ── Opdrachtgever-override (RADTEC etc.) ──────────────────────────────────
  // Controleer lading uit PDF + email body op bekende klant-patronen.
  // NB: enrichOrder loopt al in parseDFDS, dus diesel herberekenen met het nieuwe tarief.
  const combinedText = containers.map(c => c.lading || '').join(' ') + ' ' + bodyText;
  const opdrachtgeverOverride = getDFDSOpdrachtgeverOverride(combinedText);
  if (opdrachtgeverOverride) {
    for (const c of containers) {
      Object.assign(c, opdrachtgeverOverride);
      // Herbereken diesel met het vaste tarief dat de override meebrengt
      const nieuwTarief = parseFloat(c.tarief) || 0;
      if (nieuwTarief > 0) {
        const DIESEL_PERCENT = 10;
        c.dieselToeslagChart = Math.round(nieuwTarief * DIESEL_PERCENT / 100 * 100) / 100;
        console.log(`💧 Diesel herberekend na tarief-override: €${c.dieselToeslagChart} (${DIESEL_PERCENT}% van €${nieuwTarief})`);
      }
    }
    console.log(`🔄 DFDS opdrachtgever overschreven: ${opdrachtgeverOverride.opdrachtgeverNaam}`);
  }

  // ── ADR uit email body overnemen als PDF het niet detecteerde ─────────────
  const bodyHeeftAdr = (
    /Dangerous\s+Goods\s*:\s*Yes/i.test(bodyText) ||
    /\bUN\s*\d{4}\b/.test(bodyText) ||
    /\bADR\b/i.test(bodyText)
  );
  if (bodyHeeftAdr) {
    for (const c of containers) {
      if (c.adr !== 'Waar') {
        c.adr = 'Waar';
        console.log(`🔺 DFDS ADR overschreven via email body: ${c.containernummer || '(geen cntr)'}`);
      }
    }
  }

  if (getReleaseData) {
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  // Originele PDF bijlage: de daadwerkelijk gebruikte transportorder
  const origFilename = gebruiktePdf.filename || filename;
  const origBase64   = gebruiktePdf.base64   || base64;

  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_DFDS.easy`;
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      const bijlagen = [{ filename: easyFilename, path: easyPath }];
      if (origBase64) {
        bijlagen.push({ filename: origFilename, content: Buffer.from(origBase64, 'base64') });
      }
      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: `easytrip file - ${ref}`,
        text: `DFDS transportopdracht verwerkt: ${ref}`,
        attachments: bijlagen
      });
      console.log(`📧 DFDS verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'DFDS', afzenderEmail: fromEmail, bestandsnaam: origFilename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij DFDS container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'DFDS', afzenderEmail: fromEmail, bestandsnaam: origFilename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
