// 📁 handlers/handleSteinweg.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import parseSteinweg from '../parsers/parseSteinweg.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import defaultTransporter from '../utils/smtpTransport.js';

// Gebruik Gmail als GMAIL_USER/GMAIL_PASS zijn ingesteld, anders de standaard transporter
function getTransporter() {
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
    });
  }
  return defaultTransporter;
}

function getFromEmail() {
  return process.env.GMAIL_USER || process.env.FROM_EMAIL;
}

async function sendSteinwegEmail({ ritnummer, attachments }) {
  const transporter = getTransporter();
  const from = getFromEmail();
  const formattedAttachments = attachments.map(att => ({
    filename: att.filename,
    content: att.content || (att.path && fs.existsSync(att.path) ? fs.readFileSync(att.path) : Buffer.from(''))
  }));
  await transporter.sendMail({
    from,
    to: from,
    subject: `easytrip file - ${ritnummer}`,
    text: `Transportopdracht verwerkt: ${ritnummer}`,
    attachments: formattedAttachments
  });
}

let _supabase;
function getSupabase() {
  return _supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function uploadToQueue(filename, content) {
  const { error } = await getSupabase()
    .storage
    .from('easyfiles')
    .upload(`steinweg-queue/${filename}`, content, { contentType: 'application/octet-stream', upsert: true });
  if (error) throw new Error(`Queue upload failed for ${filename}: ${error.message}`);
}

export default async function handleSteinweg({ route1Buffer, route2Buffer, emailBody, emailSubject, emailSource, emailFilename }) {
  const containers = await parseSteinweg({ route1Buffer, route2Buffer, emailBody, emailSubject });

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Steinweg containers geparsed');
    return;
  }

  const useGmail = !!(process.env.GMAIL_USER && process.env.GMAIL_PASS);
  console.log(`📦 ${containers.length} Steinweg container(s) | verzendmethode: ${useGmail ? 'Gmail (direct)' : 'queue'}`);

  // Sla originele email op als .eml
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

  let processed = 0;
  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_Steinweg.easy`;
      const easyBuf      = Buffer.from(xml, 'utf-8');
      const easyPath     = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, easyBuf);

      if (useGmail) {
        // Direct verzenden via Gmail – geen limiet
        const attachments = [{ filename: easyFilename, path: easyPath }];
        if (elmPath && fs.existsSync(elmPath)) {
          attachments.push({ filename: elmFilename, path: elmPath });
        }
        await sendSteinwegEmail({ ritnummer: ref, attachments });
        console.log(`📧 Gmail: verstuurd ${easyFilename}`);
      } else {
        // Queue in Supabase voor vertraagde verzending
        await uploadToQueue(easyFilename, easyBuf);
        const meta = {
          ritnummer: ref, easyFilename,
          elmFilename: emailSource ? elmFilename : null,
          queuedAt: new Date().toISOString()
        };
        await uploadToQueue(`${easyFilename}.meta.json`, Buffer.from(JSON.stringify(meta)));
        console.log(`📬 Queue: ${easyFilename}`);
      }
      processed++;
    } catch (err) {
      console.error(`❌ Fout bij ${container.containernummer}:`, err.message);
    }
  }

  console.log(`✅ ${processed}/${containers.length} Steinweg containers verwerkt`);
  if (!useGmail) {
    console.log('💡 Stel GMAIL_USER + GMAIL_PASS in voor direct verzenden, of roep /api/process-steinweg-queue elke 5 min aan.');
  }
}
