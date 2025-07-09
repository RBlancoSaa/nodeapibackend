// services/uploadPdfAttachmentsToSupabase.js
import '../utils/fsPatch.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Upload één of meerdere PDF‐attachments naar Supabase,
 * altijd met de bestandsnaam `${referentie}.pdf`.
 *
 * @param {Array<{ content: Buffer|Uint8Array|ArrayBuffer, contentType?: string }>} attachments
 * @param {string} referentie
 * @returns {Promise<Array<{ filename: string }>>}
 */
export async function uploadPdfAttachmentsToSupabase(attachments, referentie) {
  const bucket = process.env.SUPABASE_BUCKET;
  const targetName = `${referentie}.pdf`;
  const uploadedFiles = [];

  for (const att of attachments) {
    // 1) Converteer content naar Buffer
    let buffer;
    if (Buffer.isBuffer(att.content)) {
      buffer = att.content;
    } else if (att.content instanceof Uint8Array) {
      buffer = Buffer.from(att.content);
    } else if (att.content instanceof ArrayBuffer) {
      buffer = Buffer.from(new Uint8Array(att.content));
    } else {
      console.warn(`⚠️ Ongeldige buffer in attachment, sla over.`);
      continue;
    }

    if (!buffer.length) {
      console.warn(`⚠️ Lege PDF‐buffer, sla upload over.`);
      continue;
    }

    // 2) Upload naar Supabase onder de referentie‐naam
    console.log(`📤 Uploaden naar Supabase als: ${targetName}`);
    const { error } = await supabase.storage
      .from(bucket)
      .upload(targetName, buffer, {
        contentType: att.contentType || 'application/pdf',
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error(`❌ Uploadfout voor ${targetName}:`, error.message);
    } else {
      console.log(`✅ Upload gelukt: ${targetName}`);
      uploadedFiles.push({ filename: targetName });
    }

    // Als je maar één PDF per referentie wilt, kun je hier `break;` doen.
  }

  return uploadedFiles;
}