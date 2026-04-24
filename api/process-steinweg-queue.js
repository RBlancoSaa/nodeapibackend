// 📁 api/process-steinweg-queue.js
// Verwerk maximaal 10 Steinweg emails per aanroep (max 10 per 5 min limiet).
// Aanroepen via cron elke 5 minuten totdat queue leeg is.
import '../utils/fsPatch.js';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { getGmailTransporter } from '../utils/gmailTransport.js';

async function sendEmail({ ritnummer, attachments }) {
  const { transporter, from } = getGmailTransporter();
  await transporter.sendMail({
    from, to: from,
    subject: `easytrip file - ${ritnummer}`,
    text: `Transportopdracht verwerkt: ${ritnummer}`,
    attachments: attachments.map(a => ({ filename: a.filename, content: a.content || a.path }))
  });
}

const BATCH_SIZE = 10;

let _supabase;
function getSupabase() {
  return _supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function downloadFromQueue(filename) {
  const { data, error } = await getSupabase()
    .storage
    .from('easyfiles')
    .download(`steinweg-queue/${filename}`);
  if (error) throw new Error(`Download mislukt voor ${filename}: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

async function removeFromQueue(filenames) {
  const paths = filenames.map(f => `steinweg-queue/${f}`);
  const { error } = await getSupabase().storage.from('easyfiles').remove(paths);
  if (error) console.warn('⚠️ Verwijder fout:', error.message);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Lijst alle bestanden in de queue (alleen .meta.json = één item per container)
    const { data: queueFiles, error: listErr } = await getSupabase()
      .storage
      .from('easyfiles')
      .list('steinweg-queue', { limit: 100, sortBy: { column: 'name', order: 'asc' } });

    if (listErr) throw new Error(`Lijst fout: ${listErr.message}`);

    const metaFiles = (queueFiles || [])
      .filter(f => f.name.endsWith('.meta.json'))
      .slice(0, BATCH_SIZE);

    if (metaFiles.length === 0) {
      return res.status(200).json({ success: true, message: 'Queue is leeg', sent: 0 });
    }

    console.log(`📬 ${metaFiles.length} Steinweg emails te versturen uit queue`);
    let sent = 0;
    const toRemove = [];

    for (const metaFile of metaFiles) {
      try {
        const metaBuf  = await downloadFromQueue(metaFile.name);
        const meta     = JSON.parse(metaBuf.toString('utf-8'));
        const easyBuf  = await downloadFromQueue(meta.easyFilename);

        const easyPath = path.join(os.tmpdir(), meta.easyFilename);
        fs.writeFileSync(easyPath, easyBuf);

        const attachments = [{ filename: meta.easyFilename, path: easyPath }];

        // Voeg originele email toe als .eml bijlage
        if (meta.elmFilename) {
          try {
            const elmBuf  = await downloadFromQueue(`eml/${meta.elmFilename}`);
            const elmPath = path.join(os.tmpdir(), meta.elmFilename);
            fs.writeFileSync(elmPath, elmBuf);
            attachments.push({ filename: meta.elmFilename, path: elmPath });
          } catch (e) {
            console.warn(`⚠️ Kan .eml niet ophalen: ${e.message}`);
          }
        }

        await sendEmail({
          ritnummer: meta.ritnummer || meta.easyFilename,
          attachments
        });

        console.log(`📧 Verstuurd: ${meta.easyFilename}`);
        toRemove.push(metaFile.name, meta.easyFilename);
        sent++;
      } catch (err) {
        console.error(`❌ Fout bij ${metaFile.name}:`, err.message);
      }
    }

    if (toRemove.length > 0) await removeFromQueue(toRemove);

    const remaining = (queueFiles?.filter(f => f.name.endsWith('.meta.json')).length || 0) - sent;
    return res.status(200).json({
      success: true,
      sent,
      remaining: Math.max(0, remaining),
      message: remaining > 0 ? `Nog ${remaining} in queue — roep dit endpoint opnieuw aan over 5 min` : 'Queue verwerkt'
    });

  } catch (err) {
    console.error('💥 process-steinweg-queue fout:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
