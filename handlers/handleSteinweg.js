// 📁 handlers/handleSteinweg.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import parseSteinweg from '../parsers/parseSteinweg.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

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

  console.log(`📦 ${containers.length} Steinweg container(s) – in queue plaatsen`);

  // Upload original email as .eml for later attachment
  const ordernummer = containers[0]?.ritnummer || `steinweg_${Date.now()}`;
  const elmFilename = `${ordernummer}.eml`;
  if (emailSource) {
    try {
      const elmBuf = Buffer.isBuffer(emailSource) ? emailSource : Buffer.from(emailSource);
      await uploadToQueue(`eml/${elmFilename}`, elmBuf);
      console.log(`📧 Email opgeslagen: ${elmFilename}`);
    } catch (err) {
      console.warn('⚠️ Email upload mislukt:', err.message);
    }
  }

  let queued = 0;
  for (const container of containers) {
    try {
      const xml = await generateXmlFromJson(container);
      const cntr = container.containernummer || 'onbekend';
      const ref  = container.ritnummer || cntr;
      const easyFilename = `Order_${ref}_${cntr}_Steinweg.easy`;

      // Queue: upload .easy
      await uploadToQueue(easyFilename, Buffer.from(xml, 'utf-8'));

      // Queue: upload meta JSON
      const meta = {
        ritnummer:  ref,
        easyFilename,
        elmFilename: emailSource ? elmFilename : null,
        queuedAt:   new Date().toISOString()
      };
      await uploadToQueue(`${easyFilename}.meta.json`, Buffer.from(JSON.stringify(meta), 'utf-8'));

      queued++;
      console.log(`✅ In queue: ${easyFilename}`);
    } catch (err) {
      console.error(`❌ Fout bij queuen ${container.containernummer}:`, err.message);
    }
  }

  console.log(`📬 ${queued}/${containers.length} containers in Steinweg-queue geplaatst`);
  console.log('💡 Roep /api/process-steinweg-queue aan om emails te versturen (max 10 per 5 min)');
}
