// handlers/handleKWE.js
// KWE (Kintetsu World Express Benelux) import-orders — vrije email tekst, geen PDF
//
// Verwacht formaat:
//   Afhalen bij:          → terminal
//   Aanleveren bij:       → klantnaam + adres (soms incompleet)
//   Aanleveren:           → datum(s) en schema
//   Boot :                → scheepsnaam
//   Onze referentie ... : → ritnummer (of "KWE ref #" in body/subject)
//
// PDF-bijlagen zijn release-documenten, geen transportorders.
// preferBody: true in upload-from-inbox zorgt dat alle PDFs als bijlage meekomen.
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { enrichOrder } from '../utils/enrichOrder.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';

function parseDatumNL(str) {
  // "07-05-2026", "07-05", "07.05.2026"
  const m = (str || '').match(/(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{4}))?/);
  if (!m) return '';
  const dag  = m[1].padStart(2, '0');
  const mnd  = m[2].padStart(2, '0');
  const jaar = m[3] || String(new Date().getFullYear());
  return `${dag}-${mnd}-${jaar}`;
}

function normalizeContainerType(raw) {
  const r = (raw || '').toUpperCase().replace(/\s+/g, '');
  const isHC = /HC|HQ|HIGHCUBE/.test(r);
  if (/45/.test(r)) return isHC ? '45ft HC' : '45ft';
  if (/20/.test(r)) return isHC ? '20ft HC' : '20ft';
  return isHC ? '40ft HC' : '40ft'; // default 40
}

/** Haal regels op na een label-regel tot de volgende sectie of max N regels */
function getBlock(lines, labelRe, maxLines = 6) {
  const idx = lines.findIndex(l => labelRe.test(l));
  if (idx < 0) return [];
  const block = [];
  for (let i = idx + 1; i < Math.min(idx + 1 + maxLines, lines.length); i++) {
    // Stop bij een nieuwe sectieheader (regel eindigt op ":" en is kort)
    if (/^[A-Za-zÀ-ɏ][^\n]{0,35}:\s*$/.test(lines[i])) break;
    if (lines[i]) block.push(lines[i]);
  }
  return block;
}

export default async function handleKWE({ bodyText = '', mailSubject = '', fromEmail = '', pdfAttachments = [] }) {
  const body    = (bodyText || '').replace(/\r\n/g, '\n');
  const subject = mailSubject || '';
  const lines   = body.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`📦 KWE email verwerken: ${subject}`);

  // === Ritnummer ===
  // "Onze referentie voor uw Factuur : 75026F000221"
  // "KWE ref # 75026F000221"
  // Subject: "... / KWE ref # 75026F000221"
  let ritnummer = '';
  const refBodyMatch = body.match(/(?:onze\s+referentie[^:\n]{0,30}|KWE\s+ref\s*[# ]*)\s*[:\-]\s*([A-Z0-9]{6,})/i);
  if (refBodyMatch) ritnummer = refBodyMatch[1].trim();
  if (!ritnummer) {
    // Subject: neem laatste segment na "/" dat enkel alfanumeriek is (≥ 6 tekens)
    const subParts = subject.split('/').map(s => s.trim());
    const candidate = [...subParts].reverse().find(p => /^[A-Z0-9]{6,}$/i.test(p.replace(/[\s#]/g, '')));
    if (candidate) ritnummer = candidate.replace(/[\s#]/g, '');
  }

  // === Container type & count ===
  // "10x 40HC", "2X 40FT HIGH CUBE", "2x 20ft"
  const ctMatch = (subject + ' ' + body).match(/(\d+)\s*[xX]\s*(\d+)\s*(?:ft|FT)?\s*(HC|HQ|high[\s\-]?cube|\bHC\b)?/i);
  const containerCount = ctMatch ? parseInt(ctMatch[1]) : 1;
  const containertype  = ctMatch ? normalizeContainerType(`${ctMatch[2]}${ctMatch[3] || ''}`) : '40ft';

  // === Terminal (Afhalen bij:) ===
  const afhalenBlock = getBlock(lines, /^afhalen\s+bij\s*:/i, 3);
  const terminalRaw  = afhalenBlock[0] || '';

  // === Klant (Aanleveren bij:) ===
  // Soms alleen naam + stad, soms volledig adres incl. postcode
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
      // Geen postcode → naam + evt. stad
      klantNaam  = aanlevBijBlock[0] || '';
      klantPlaats = aanlevBijBlock[1] || '';
    }
  }

  // === Datum (eerste datum na "Aanleveren:" of in subject) ===
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

  // === Scheepsnaam (Boot : / Vessel :) ===
  const bootMatch = body.match(/(?:Boot|Vessel|Schip)\s*[:\-]\s*(.+?)(?:\n|\.)/i);
  const bootnaam  = bootMatch ? bootMatch[1].trim().replace(/\s*[.,]$/, '') : '';

  // === Instructies ===
  const instrParts = [];
  // Containeraantal (altijd vermelden)
  instrParts.push(`${containerCount}x ${containertype}`);
  // Aanleverschema (meerdere data)
  if (aanlevSchema) {
    const schema = aanlevSchema[1].trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (schema.length > 0) instrParts.push(schema.join(' | '));
  }
  // Telefoonnummer "bellen naar:"
  const telMatch = body.match(/bellen\s+naar\s*[:\-]\s*([^\n,]{4,20})/i);
  if (telMatch) instrParts.push(`Bellen: ${telMatch[1].trim()}`);
  // ETA
  const etaMatch = body.match(/ETA[^:\n]{0,20}:\s*([^\n]+)/i);
  if (etaMatch) instrParts.push(`ETA: ${etaMatch[1].trim()}`);
  // Leeg retour
  const leegMatch = body.match(/Leeg\s+retour\s*:\s*([^\n]+)/i);
  if (leegMatch) instrParts.push(`Leeg retour: ${leegMatch[1].trim()}`);

  const instructies = instrParts.filter(Boolean).join(' | ');

  console.log(`🔍 KWE: ritnummer="${ritnummer}" ${containerCount}× ${containertype}`);
  console.log(`🔍 KWE: terminal="${terminalRaw}" datum="${datum}"`);
  console.log(`🔍 KWE: klant="${klantNaam}" adres="${klantAdres}" pc="${klantPC}" plaats="${klantPlaats}"`);
  console.log(`🔍 KWE: boot="${bootnaam}" instructies="${instructies}"`);

  if (!ritnummer && !klantNaam) {
    console.warn('⚠️ KWE: onvoldoende data (geen ritnummer en geen klantnaam) — verwerking gestopt');
    return [];
  }

  let container;
  try {
    container = await enrichOrder({
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

      containernummer: '',
      containertype,

      datum,
      tijd:              '',
      referentie:        ritnummer,
      laadreferentie:    '',
      inleverreferentie: '',
      inleverBestemming: '',

      rederijRaw:      '',
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
        {
          volgorde: '0', actie: 'Opzetten',
          naam: terminalRaw, adres: '', postcode: '', plaats: '', land: 'NL'
        },
        {
          volgorde: '0', actie: 'Lossen',
          naam: klantNaam, adres: klantAdres, postcode: klantPC, plaats: klantPlaats,
          land: klantLand
        },
        {
          volgorde: '0', actie: 'Afzetten',
          naam: '', adres: '', postcode: '', plaats: '', land: 'NL',
          _noTerminalLookup: true
        }
      ]
    }, { bron: 'KWE' });
  } catch (err) {
    console.error(`❌ KWE enrichOrder fout:`, err.message);
    return [];
  }

  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  try {
    const xml = await generateXmlFromJson(container);
    const ref  = container.ritnummer || ritnummer || 'KWE';
    const easyFilename = `Order_${ref}_KWE.easy`;
    const easyPath     = path.join(os.tmpdir(), easyFilename);
    fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

    // Originele email body als bijlage
    const bodyFilename = `Email_${ref}_KWE.txt`;
    const bodyPath     = path.join(os.tmpdir(), bodyFilename);
    fs.writeFileSync(bodyPath, Buffer.from(`Onderwerp: ${subject}\nVan: ${fromEmail}\n\n${body}`, 'utf-8'));

    const bijlagen = [
      { filename: easyFilename, path: easyPath },
      { filename: bodyFilename, path: bodyPath }
    ];
    // Release PDFs meesturen als bijlage
    for (const pdf of (pdfAttachments || [])) {
      if (pdf.buffer && Buffer.isBuffer(pdf.buffer)) {
        bijlagen.push({ filename: pdf.filename, content: pdf.buffer });
      }
    }

    await transporter.sendMail({
      from, to: RECIPIENT_EMAIL,
      subject: `easytrip file - ${ref}`,
      text: [
        `KWE opdracht verwerkt: ${ref}`,
        datum    ? `Datum: ${datum}` : '',
        klantNaam ? `Klant: ${klantNaam}${klantPlaats ? ', ' + klantPlaats : ''}` : '',
        bootnaam  ? `Schip: ${bootnaam}` : '',
        instructies || ''
      ].filter(Boolean).join('\n'),
      attachments: bijlagen
    });

    console.log(`📧 KWE verstuurd: ${easyFilename} (+ ${bijlagen.length - 1} bijlage(n))`);
    easyBestanden.push(easyFilename);
    await logOpdracht({ bron: 'KWE', afzenderEmail: fromEmail, bestandsnaam: mailSubject, container, easyBestand: easyFilename });
  } catch (err) {
    console.error(`❌ Fout bij KWE opdracht:`, err.message);
    await logOpdracht({ bron: 'KWE', afzenderEmail: fromEmail, bestandsnaam: mailSubject, container: container || {}, status: 'FOUT', foutmelding: err.message });
  }

  return easyBestanden;
}
