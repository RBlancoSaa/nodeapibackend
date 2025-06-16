// 📁 nodeapibackend/services/uploadPdfAttachmentsToSupabase.js

import { createClient } from '@supabase/supabase-js';

// ✅ Supabase setup vanuit Vercel env
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Uploadt PDF-bestanden naar Supabase Storage vanuit een lijst met bijlagen.
 * @param {Array} attachments - [{ uid, filename, contentType, content }]
 * @returns {Array} uploadedFiles - Lijst met { filename, url }
 */
export async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

  console.log('🔐 KEY lengte:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length);
  console.log('📦 Aantal attachments:', attachments.length);

  for (const att of attachments) {
    if (!att.filename?.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Skip (geen pdf): ${att.filename}`);
      continue;
    }

    if (!att.content || !Buffer.isBuffer(att.content)) {
      console.warn(`⛔ Ongeldige buffer voor ${att.filename}`);
      continue;
    }

    try {
      const { error } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(att.filename, att.content, {
          contentType: att.contentType || 'application/pdf',
          upsert: true,
        });

      if (error) {
        console.error(`❌ Uploadfout (${att.filename}):`, error.message);
        continue;
      }

      const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${att.filename}`;
      uploadedFiles.push({ filename: att.filename, url });

      console.log(`✅ Upload: ${att.filename}`);
    } catch (err) {
      console.error(`💥 Exception bij upload van ${att.filename}:`, err.message);
    }
  }

  return uploadedFiles;
}