// 📁 handlers/handleSteinweg.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import parseSteinweg from '../parsers/parseSteinweg.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, hasGmail, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';
import { logOpdracht } from '../utils/logOpdracht.js';

// ── Helpers: groeperen op afzetdepot ────────────────────────────────────────

/**
 * Groepeert containers op het afzetdepot (locaties.at(-1).naam).
 * Containers met hetzelfde depot krijgen één gezamenlijk .easy bestand
 * met een duplicatienota in de bijzonderheden.
 *
 * Route 1 (vol) en Route 2 (leeg) worden automatisch gescheiden omdat
 * hun afzetlocaties altijd anders zijn (Steinweg vs. return depot).
 *
 * @returns {Array<{ depotSleutel: string, depotNaam: string, containers: object[] }>}
 */
function groepeerOpAfzetdepot(containers) {
  const map = new Map();
  for (const c of containers) {
    const depotNaam = c.locaties?.at(-1)?.naam || 'onbekend';
    const sleutel = depotNaam.trim().toLowerCase();
    if (!map.has(sleutel)) map.set(sleutel, { depotSleutel: sleutel, depotNaam, containers: [] });
    map.get(sleutel).containers.push(c);
  }
  return [...map.values()];
}

/**
 * Bouwt de duplicatienota die in bijzonderheden komt voor groepen van >1 container.
 * Toont per container: containernummer - zegel - ref - containertype - gewicht - lading - ADR
 * Lege velden worden weggelaten zodat de nota compact blijft.
 */
function bouwDuplicatieNota(groep) {
  const n = groep.length;
  const regels = groep.map(c => {
    const delen = [c.containernummer];
    if (c.brutogewicht && c.brutogewicht !== '0')        delen.push(`${c.brutogewicht} kg`);
    if (c.zegel)                                         delen.push(`zegel: ${c.zegel}`);
    if (c.referentie)                                    delen.push(`ref: ${c.referentie}`);
    if (c.inleverreferentie)                             delen.push(`afzetref: ${c.inleverreferentie}`);
    if (c.containertype)                                 delen.push(c.containertype);
    if (c.lading)                                        delen.push(c.lading);
    if (c.adr === 'Waar')                                delen.push('ADR');
    return delen.join(' - ');
  });
  return `${n}x dupliceren:\n${regels.join('\n')}`;
}

// ── Gmail ────────────────────────────────────────────────────────────────────

async function sendSteinwegEmail({ ritnummer, emailTekst, attachments }) {
  const { transporter, from } = await getGmailTransporter();
  const formatted = attachments.map(att => ({
    filename: att.filename,
    content: att.content || (att.path && fs.existsSync(att.path) ? fs.readFileSync(att.path) : Buffer.from(''))
  }));
  await transporter.sendMail({
    from,
    to: RECIPIENT_EMAIL,
    subject: `easytrip file - ${ritnummer}`,
    text: emailTekst,
    attachments: formatted
  });
}

// ── Supabase queue ────────────────────────────────────────────────────────────

let _supabase;
function getSupabase() {
  return _supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function uploadToQueue(filename, content) {
  const { error } = await getSupabase()
    .storage
    .from('easyfiles')
    .upload(`steinweg-queue/${filename}`, content, { contentType: 'application/octet-stream', upsert: true });
  if (error) throw new Error(`Queue upload mislukt voor ${filename}: ${error.message}`);
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handleSteinweg({
  route1Buffer, route2Buffer,
  route1Filename, route2Filename,
  emailBody, emailSubject, emailSource,
  fromEmail = '',
  getReleaseData = null
}) {
  const containers = await parseSteinweg({ route1Buffer, route2Buffer, emailBody, emailSubject });

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Steinweg containers geparsed');
    return;
  }

  if (getReleaseData) {
    const { mergeRelease } = await import('../utils/mergeRelease.js');
    for (const c of containers) mergeRelease(c, getReleaseData(c.containernummer));
  }

  const useGmail = hasGmail();

  // ── Groepeer op afzetdepot ────────────────────────────────────────────────
  const groepen = groepeerOpAfzetdepot(containers);
  console.log(`📦 ${containers.length} Steinweg container(s) → ${groepen.length} groep(en) | ${useGmail ? 'Gmail OAuth2' : 'queue'}`);
  for (const g of groepen) {
    console.log(`  📍 "${g.depotNaam}" → ${g.containers.length}x container(s)`);
  }

  const ordernummer = containers[0]?.ritnummer || `steinweg_${Date.now()}`;
  const elmFilename = `${ordernummer}.eml`;
  let elmPath = null;

  if (emailSource) {
    try {
      const elmBuf = Buffer.isBuffer(emailSource) ? emailSource : Buffer.from(emailSource);
      elmPath = path.join(os.tmpdir(), elmFilename);
      fs.writeFileSync(elmPath, elmBuf);
      if (!useGmail) await uploadToQueue(`eml/${elmFilename}`, elmBuf);
    } catch (err) {
      console.warn('⚠️ Email opslaan mislukt:', err.message);
    }
  }

  const easyBestanden = [];

  // ── Per groep: één .easy aanmaken + één aparte email versturen ───────────
  for (const { depotNaam, containers: groep } of groepen) {
    // Base container = eerste in de groep; kopie zodat instructies niet muteert
    const base = { ...groep[0] };

    // Duplicatienota toevoegen aan bijzonderheden als de groep >1 container heeft
    if (groep.length > 1) {
      const nota = bouwDuplicatieNota(groep);
      base.instructies = base.instructies
        ? `${base.instructies}\n\n${nota}`
        : nota;
      console.log(`📋 Groep "${depotNaam}": ${groep.length}x → duplicatienota in bijzonderheden`);
    }

    try {
      const xml = await generateXmlFromJson(base);
      const cntr = base.containernummer || 'onbekend';
      const ref  = base.ritnummer || cntr;
      const isRetour = !base.brutogewicht || base.brutogewicht === '0';
      const suffix   = isRetour ? 'Retour' : 'Lossen';

      // Bestandsnaam: groepen tonen aantal, enkelen tonen containernummer
      const easyFilename = groep.length > 1
        ? `Order_${ref}_${groep.length}x_Steinweg_${suffix}.easy`
        : `Order_${ref}_${cntr}_Steinweg_${suffix}.easy`;

      const easyBuf  = Buffer.from(xml, 'utf-8');
      const easyPath = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, easyBuf);

      if (!useGmail) {
        await uploadToQueue(easyFilename, easyBuf);
        const meta = {
          ritnummer: ref,
          easyFilename,
          elmFilename: emailSource ? elmFilename : null,
          queuedAt: new Date().toISOString()
        };
        await uploadToQueue(`${easyFilename}.meta.json`, Buffer.from(JSON.stringify(meta)));
        console.log(`📬 In queue: ${easyFilename}`);
      }

      easyBestanden.push(easyFilename);

      // ── Stuur aparte email per .easy ──────────────────────────────────────
      if (useGmail) {
        // Bijlagen: het .easy bestand + originele Excel(s) + eml
        const attachments = [{ filename: easyFilename, path: easyPath }];
        if (elmPath && fs.existsSync(elmPath))  attachments.push({ filename: elmFilename, path: elmPath });
        if (route1Buffer) attachments.push({ filename: route1Filename || 'Steinweg-Route1.xlsx', content: route1Buffer });
        if (route2Buffer) attachments.push({ filename: route2Filename || 'Steinweg-Route2.xlsx', content: route2Buffer });

        // Email-tekst: duplicatienota ook zichtbaar in de email body
        let emailTekst;
        if (groep.length > 1) {
          const containerRegels = groep.map(c => {
            const delen = [`  • ${c.containernummer}`];
            if (c.brutogewicht && c.brutogewicht !== '0') delen.push(`${c.brutogewicht} kg`);
            if (c.zegel)                                  delen.push(`zegel: ${c.zegel}`);
            if (c.referentie)                             delen.push(`ref: ${c.referentie}`);
            if (c.inleverreferentie)                      delen.push(`afzetref: ${c.inleverreferentie}`);
            if (c.adr === 'Waar')                         delen.push('ADR');
            return delen.join(' - ');
          });
          emailTekst = [
            `Steinweg — ${groep.length}x dupliceren naar: ${depotNaam}`,
            '',
            `${groep.length}x dupliceren:`,
            ...containerRegels
          ].join('\n');
        } else {
          emailTekst = `Steinweg transportopdracht: ${cntr} → ${depotNaam}`;
        }

        await sendSteinwegEmail({ ritnummer: ref, emailTekst, attachments });
        console.log(`📧 Email verstuurd: ${easyFilename} (${groep.length}x container)`);
      }

      // logOpdracht voor elke container in de groep
      for (const c of groep) {
        await logOpdracht({
          bron: 'Steinweg',
          afzenderEmail: fromEmail,
          bestandsnaam: route1Filename || '',
          container: c,
          easyBestand: easyFilename
        });
      }
    } catch (err) {
      console.error(`❌ Fout bij depot "${depotNaam}":`, err.message);
      for (const c of groep) {
        await logOpdracht({
          bron: 'Steinweg',
          afzenderEmail: fromEmail,
          bestandsnaam: route1Filename || '',
          container: c,
          status: 'FOUT',
          foutmelding: err.message
        });
      }
    }
  }

  console.log(`✅ ${easyBestanden.length} email(s) verstuurd voor ${containers.length} Steinweg container(s) in ${groepen.length} groep(en)`);
  return easyBestanden;
}
