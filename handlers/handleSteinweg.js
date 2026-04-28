// 📁 handlers/handleSteinweg.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import parseSteinweg from '../parsers/parseSteinweg.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter, hasGmail } from '../utils/gmailTransport.js';

async function sendSteinwegEmail({ ritnummer, attachments }) {
  const { transporter, from } = await getGmailTransporter();
  const formatted = attachments.map(att => ({
    filename: att.filename,
    content: att.content || (att.path && fs.existsSync(att.path) ? fs.readFileSync(att.path) : Buffer.from(''))
  }));
  const to = process.env.RECIPIENT_EMAIL || from;
  await transporter.sendMail({
    from,
    to,
    subject: `easytrip file - ${ritnummer}`,
    text: `Transportopdracht verwerkt: ${ritnummer}`,
    attachments: formatted
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
  if (error) throw new Error(`Queue upload mislukt voor ${filename}: ${error.message}`);
}

export default async function handleSteinweg({ route1Buffer, route2Buffer, route1Filename, route2Filename, emailBody, emailSubject, emailSource }) {
  const containers = await parseSteinweg({ route1Buffer, route2Buffer, emailBody, emailSubject });

  if (!containers || containers.length === 0) {
    console.warn('⚠️ Geen Steinweg containers geparsed');
    return;
  }

  const useGmail = hasGmail();
  console.log(`📦 ${containers.length} Steinweg container(s) | ${useGmail ? 'Gmail OAuth2 (direct)' : 'queue'}`);

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

  // Bouw alle .easy bestanden
  const easyBestanden = [];
  const easyAttachments = [];

  for (const container of containers) {
    try {
      const xml  = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      // Route 1 = Lossen, Route 2 = Retour (leeg)
      const suffix = container.locaties?.[2]?.naam ? 'Retour' : 'Lossen';
      const easyFilename = `Order_${ref}_${cntr}_Steinweg_${suffix}.easy`;
      const easyBuf      = Buffer.from(xml, 'utf-8');
      const easyPath     = path.join(os.tmpdir(), easyFilename);
      fs.writeFileSync(easyPath, easyBuf);
      if (!useGmail) {
        await uploadToQueue(easyFilename, easyBuf);
        const meta = { ritnummer: ref, easyFilename, elmFilename: emailSource ? elmFilename : null, queuedAt: new Date().toISOString() };
        await uploadToQueue(`${easyFilename}.meta.json`, Buffer.from(JSON.stringify(meta)));
        console.log(`📬 In queue: ${easyFilename}`);
      }
      easyBestanden.push(easyFilename);
      easyAttachments.push({ filename: easyFilename, path: easyPath });
    } catch (err) {
      console.error(`❌ Fout bij ${container.containernummer}:`, err.message);
    }
  }

  // Stuur één email met alle .easy + originele Excel + eml
  if (useGmail && easyAttachments.length > 0) {
    const attachments = [...easyAttachments];
    if (elmPath && fs.existsSync(elmPath)) {
      attachments.push({ filename: elmFilename, path: elmPath });
    }
    if (route1Buffer) attachments.push({ filename: route1Filename || 'Steinweg-Route1.xlsx', content: route1Buffer });
    if (route2Buffer) attachments.push({ filename: route2Filename || 'Steinweg-Route2.xlsx', content: route2Buffer });

    await sendSteinwegEmail({ ritnummer: ordernummer, attachments });
    console.log(`📧 Verstuurd: ${easyAttachments.length} .easy + ${route1Buffer ? 1 : 0} + ${route2Buffer ? 1 : 0} xlsx`);
  }

  console.log(`✅ ${easyBestanden.length}/${containers.length} Steinweg containers verwerkt`);
  return easyBestanden;
}
