// handlers/handleKWE.js
// Verwerkt KWE emails (body-only, geen PDF).
// Formaat: onderwerp "RESERVEREN/ 2X 40FT / DELTA- UTRECHT/ 75026F000224"
//          body: LADEN, LEVEREN datum/tijden, klantnaam/adres, scheepsnaam
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { enrichOrder } from '../utils/enrichOrder.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';

function parseDatumNL(str) {
  const m = (str || '').match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})/);
  if (!m) return '';
  return `${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}-${m[3]}`;
}

export default async function handleKWE({ bodyText = '', mailSubject = '', fromEmail = '' }) {
  const body    = bodyText || '';
  const subject = mailSubject || '';
  console.log(`📦 KWE email verwerken: ${subject}`);

  // === Referentie / ritnummer ===
  // Onderwerp: "RESERVEREN/ 2X 40FT / DELTA- UTRECHT/ 75026F000224"
  // Neem het laatste stuk na "/" dat volledig alfanumeriek is (≥ 6 tekens)
  const subParts   = subject.split('/').map(s => s.trim());
  const ritnummer  = [...subParts].reverse().find(p => /^[A-Z0-9]{6,}$/i.test(p)) || '';

  // === Container type & count ===
  // "2x 40ft" of "2X 40FT HIGH CUBE" in onderwerp of body
  const containerMatch = (subject + ' ' + body).match(/(\d+)\s*[xX]\s+([\w\s]*?(?:ft|FT)(?:\s+high\s+cube|\s+HC)?)/i);
  const containerCount   = parseInt(containerMatch?.[1] || '1');
  const containertypeRaw = containerMatch?.[2]?.trim() || '40ft';
  const containertype    = /high.?cube|HC/i.test(containertypeRaw)
    ? (/40/i.test(containertypeRaw) ? '40ft HC' : '45ft HC')
    : (/40/i.test(containertypeRaw) ? '40ft' : '20ft');

  // === Terminal (LADEN: DELTA) ===
  const ladenMatch  = body.match(/LADEN\s*:\s*(.+?)(?:\r?\n|$)/i);
  const terminalRaw = ladenMatch ? ladenMatch[1].trim() : '';

  // === Datum & Tijden (LEVEREN : 12.05.2025 , 08.00 + 11.00u) ===
  const leverenLine = body.match(/LEVEREN\s*:\s*(.+?)(?:\r?\n|$)/i);
  const leverenText = leverenLine ? leverenLine[1] : '';
  const datumMatch  = leverenText.match(/(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{4})/);
  const datum       = datumMatch ? parseDatumNL(datumMatch[1]) : '';
  // Tijden: "08.00 + 11.00u" → ["08:00:00", "11:00:00"]
  const tijdMatches = [...(leverenText.matchAll(/(\d{1,2})[.:](\d{2})\s*u?/gi))];
  const tijden      = tijdMatches.map(m => `${m[1].padStart(2,'0')}:${m[2]}:00`);

  // === Klant: naam, adres, postcode, plaats, land ===
  const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Postcode-regel: "3543 MB Utrecht"
  const pcLineIdx   = lines.findIndex(l => /^\d{4}\s*[A-Z]{2}\s+\w/i.test(l));
  const pcLine      = pcLineIdx >= 0 ? lines[pcLineIdx] : '';
  const pcMatch     = pcLine.match(/^(\d{4}\s*[A-Z]{2})\s+(.+)/i);
  const klantPC     = pcMatch ? pcMatch[1].replace(/(\d{4})\s*([A-Z]{2})/i, '$1 $2') : '';
  const klantPlaats = pcMatch ? pcMatch[2].split(',')[0].trim() : '';
  const klantLandRaw = pcLineIdx >= 0 ? (lines[pcLineIdx + 1] || '') : '';
  const klantLand   = /netherlands|nederland/i.test(klantLandRaw) ? 'NL' : (klantLandRaw || 'NL');

  // Klantnaam & adres: eerste echte bedrijfsnaam na de LEVEREN-regel
  const leverenIdx   = lines.findIndex(l => /^LEVEREN\s*:/i.test(l));
  const adresStartIdx = leverenIdx >= 0 ? leverenIdx + 1 : 0;
  const SKIP_KWE_RE  = /^(?:tel|mob|ever\s|imo\s|planning|eta|etd|\+31|www\.)/i;
  const klantNaam    = lines.slice(adresStartIdx).find(
    l => !SKIP_KWE_RE.test(l) && !/^\d{4}/.test(l)
  ) || '';
  const klantNaamIdx = klantNaam ? lines.indexOf(klantNaam) : -1;
  const klantAdres   = klantNaamIdx >= 0 ? (lines[klantNaamIdx + 1] || '') : '';

  // === Scheepsnaam (staat vóór "Planning:") ===
  const planningIdx = lines.findIndex(l => /^Planning\s*:/i.test(l));
  const bootnaam    = planningIdx > 0 ? (lines[planningIdx - 1] || '') : '';

  // === Reservering-label ===
  const isReservering = /reserv[ae]r/i.test(subject) || /reserv[ae]r/i.test(body.slice(0, 120));
  const reserveringLabel = isReservering ? 'RESERVERING' : '';

  console.log(`🔍 KWE: ritnummer="${ritnummer}" containers=${containerCount}× ${containertype}`);
  console.log(`🔍 KWE: terminal="${terminalRaw}" datum="${datum}" tijden=[${tijden.join(', ')}]`);
  console.log(`🔍 KWE: klant="${klantNaam}" adres="${klantAdres}" pc="${klantPC}" plaats="${klantPlaats}"`);
  console.log(`🔍 KWE: boot="${bootnaam}" reservering=${isReservering}`);

  if (!klantNaam && !ritnummer) {
    console.warn('⚠️ KWE: onvoldoende data (geen klantnaam en geen ritnummer) — verwerking gestopt');
    return [];
  }

  const { transporter, from } = await getGmailTransporter();
  const easyBestanden = [];

  for (let i = 0; i < containerCount; i++) {
    const cTijd = tijden[i] || tijden[0] || '';

    const locaties = [
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
        naam: '', adres: '', postcode: '', plaats: '', land: 'NL'
      }
    ];

    let container;
    try {
      container = await enrichOrder({
        ritnummer,
        klantnaam:     klantNaam,
        klantadres:    klantAdres,
        klantpostcode: klantPC,
        klantplaats:   klantPlaats,

        opdrachtgeverNaam:     'KWE',
        opdrachtgeverAdres:    '',
        opdrachtgeverPostcode: '',
        opdrachtgeverPlaats:   '',
        opdrachtgeverTelefoon: '',
        opdrachtgeverEmail:    fromEmail || '',
        opdrachtgeverBTW:      '',
        opdrachtgeverKVK:      '',

        containernummer: '',
        containertype,

        datum,
        tijd:              cTijd,
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
        instructies:   reserveringLabel,
        tar: '', documentatie: '', tarra: '0', brix: '0',

        locaties
      }, { bron: 'KWE' });
    } catch (err) {
      console.error(`❌ KWE enrichOrder fout:`, err.message);
      continue;
    }

    try {
      const xml = await generateXmlFromJson(container);
      const ref  = container.ritnummer || ritnummer || `KWE-${i + 1}`;
      const nr   = containerCount > 1 ? `_${i + 1}` : '';
      const easyFilename = `Order_${ref}${nr}_KWE.easy`;
      const easyPath     = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

      const mailSubj = reserveringLabel
        ? `RESERVERING - easytrip file - ${ref}`
        : `easytrip file - ${ref}`;
      const mailBody = [
        reserveringLabel ? `⚠️ DIT IS EEN RESERVERING\n` : '',
        `KWE opdracht verwerkt: ${ref}`,
        datum   ? `Datum: ${datum}` : '',
        cTijd   ? `Tijd: ${cTijd}`  : '',
        klantNaam ? `Klant: ${klantNaam}, ${klantPlaats}` : '',
        bootnaam  ? `Schip: ${bootnaam}` : '',
      ].filter(Boolean).join('\n');

      await transporter.sendMail({
        from, to: RECIPIENT_EMAIL,
        subject: mailSubj,
        text:    mailBody,
        attachments: [{ filename: easyFilename, path: easyPath }]
      });
      console.log(`📧 KWE verstuurd: ${easyFilename}`);
      easyBestanden.push(easyFilename);
      await logOpdracht({ bron: 'KWE', afzenderEmail: fromEmail, bestandsnaam: mailSubject, container, easyBestand: easyFilename });
    } catch (err) {
      console.error(`❌ Fout bij KWE opdracht ${i + 1}:`, err.message);
      await logOpdracht({ bron: 'KWE', afzenderEmail: fromEmail, bestandsnaam: mailSubject, container: container || {}, status: 'FOUT', foutmelding: err.message });
    }
  }

  return easyBestanden;
}
