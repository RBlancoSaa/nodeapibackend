// handlers/handleDFDS.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseDFDS from '../parsers/parseDFDS.js';
import { enrichOrder } from '../utils/enrichOrder.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL, metOrigineel } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';
import { mergeRelease } from '../utils/mergeRelease.js';
import { checkDuplicaat, buildUpdateMelding } from '../utils/checkDuplicaat.js';

// ── Laad/los-adres overrides op basis van lading/body-tekst ─────────────────
// Overschrijft het laad/losadres (klantnaam/adres) — NIET de opdrachtgever.
// Volgorde van specificiteit: eerste match wint.
const DFDS_OPDRACHTGEVER_OVERRIDES = [
  {
    // RADTEC-orders: laad/losadres = DFDS RT ESTRON, vaste prijs €285 excl. diesel
    test: text => /radtec/i.test(text),
    data: {
      klantnaam:     'DFDS RT ESTRON',
      klantadres:    'WOLGAWEG 3',
      klantpostcode: '3198 LR',
      klantplaats:   'ROTTERDAM',
      tarief:        285,
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

  // UN-nummers extraheren voor instructies
  const unNummers = [...new Set(
    [...bodyText.matchAll(/\bUN\s*(\d{4})\b/gi)].map(m => m[1])
  )];
  const unnr          = unNummers.length > 0 ? unNummers.join(', ') : '0';
  const adrInstructie = unNummers.length > 0 ? unNummers.map(n => `UN ${n}`).join(', ') : '';

  // Datum: "Drop-off date ... : DD-MM-YYYY" of "Unloading date ... : DD-MM-YYYY"
  const datumMatch = bodyText.match(/(?:Drop-off|Unloading)\s+date[^:]*:\s*(\d{2}-\d{2}-\d{4})/i);
  const datum = datumMatch ? datumMatch[1] : '';

  // Datumbereik als er geen enkel-datum staat: "2x 13-05 + 2x 14-05" → instructie-tekst
  const datumBereikMatch = !datum
    ? bodyText.match(/(?:Drop-off|Unloading)\s+date[^:]*:\s*(.+?)(?:\r?\n|$)/i)
    : null;
  const datumBereikTekst = datumBereikMatch ? datumBereikMatch[1].trim() : '';

  // Locatie/dockcode bijv. "DC1", "DC6"
  const locMatch = bodyText.match(/Drop-off\s+location[^:]*:\s*(.+?)(?:\r?\n|$)/i);
  const locCode = locMatch ? locMatch[1].trim() : '';

  // LET OP-tekst (bijv. "LET OP, DEZE CONTAINERS WORDEN ZELFDE DAG OVERGELADEN IN TRAILER!!!")
  const letOpMatch = bodyText.match(/LET\s+OP[,!:\s]*([^\r\n]{5,})/i);
  const letOpTekst = letOpMatch ? `LET OP: ${letOpMatch[1].replace(/!+$/, '').trim()}` : '';

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
    adrInstructie,
    locCode ? `Locatie: ${locCode}` : '',
    datumBereikTekst ? `Datum: ${datumBereikTekst}` : '',
    letOpTekst,
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
    inleverBestemming: '',   // wordt na enrichOrder gevuld vanuit Afzetten-locatienaam
    adr,
    unnr,
    imo:               '0',
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
      // Diesel percentage terugzetten zodat enrichOrder het bedrag berekent over het nieuwe tarief
      c.dieselToeslagChart = 10;
      // Laad/losadres ook doorzetten naar de Laden/Lossen-locatie (body-orders hebben die leeg)
      if (opdrachtgeverOverride.klantnaam) {
        const laadLoc = (c.locaties || []).find(l => /laden|lossen/i.test(l.actie || ''));
        if (laadLoc) {
          laadLoc.naam     = opdrachtgeverOverride.klantnaam;
          laadLoc.adres    = opdrachtgeverOverride.klantadres    || laadLoc.adres;
          laadLoc.postcode = opdrachtgeverOverride.klantpostcode || laadLoc.postcode;
          laadLoc.plaats   = opdrachtgeverOverride.klantplaats   || laadLoc.plaats;
        }
      }
      console.log(`💧 Diesel toeslag na tarief-override: 10% (tarief €${parseFloat(c.tarief) || 0})`);
    }
    console.log(`🔄 DFDS laad/losadres overschreven: ${opdrachtgeverOverride.klantnaam} — tarief €${opdrachtgeverOverride.tarief || '?'}`);
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

      const vorigeEntry = await checkDuplicaat(cntr, 'DFDS');
      const isUpdate    = !!vorigeEntry;
      if (isUpdate) console.log(`🔁 DFDS update gedetecteerd: ${cntr}`);

      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: isUpdate ? `UPDATE easytrip file - ${ref}` : `easytrip file - ${ref}`,
        text: metOrigineel(
          isUpdate
            ? `${buildUpdateMelding(vorigeEntry, cntr)}\nDFDS transportopdracht verwerkt: ${ref}`
            : `DFDS transportopdracht verwerkt: ${ref}`,
          bodyText),
        attachments: bijlagen
      });
      console.log(`📧 DFDS verstuurd: ${easyFilename}${isUpdate ? ' (UPDATE)' : ''}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'DFDS', afzenderEmail: fromEmail, bestandsnaam: origFilename, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij DFDS container ${container.containernummer}:`, err.message);
      await logOpdracht({ bron: 'DFDS', afzenderEmail: fromEmail, bestandsnaam: origFilename, container, status: 'FOUT', foutmelding: err.message });
    }
  }
  return easyBestanden;
}
