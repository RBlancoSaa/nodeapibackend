// 📁 automatinglogistics-api/services/uploadPdfAttachmentsToSupabase.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// ✅ Supabase setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Uploadt PDF-bestanden naar Supabase Storage vanuit een lijst met bijlagen.
 * @param {Array} attachments - [{ uid, filename, contentType, content }]
 * @returns {Array} uploadedFiles - Lijst met { filename, url }
 */
export async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

  console.log('🔐 SUPABASE_URL:', supabaseUrl);
  console.log('🔐 SUPABASE_KEY aanwezig:', !!supabaseKey);
  console.log('📦 Totaal attachments ontvangen:', attachments.length);

  for (const att of attachments) {
    if (!att.filename?.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Bestand overgeslagen (geen .pdf): ${att.filename}`);
      continue;
    }

    console.log(`➡️ Uploaden: ${att.filename}`);
    console.log(`📂 Grootte: ${att.content?.length ?? 'onbekend'} bytes`);
    console.log(`📂 Is Buffer: ${Buffer.isBuffer(att.content)}`);

    if (!att.content || !Buffer.isBuffer(att.content)) {
      console.error(`⛔ Ongeldige of ontbrekende buffer voor ${att.filename}`);
      continue;
    }

    try {
      const { data, error } = await supabase.storage
        .from('inboxpdf')
        .upload(att.filename, att.content, {
          contentType: att.contentType || 'application/pdf',
          cacheControl: '3600',
          upsert: true,
        });

      if (error) {
        console.error(`❌ Uploadfout (${att.filename}):`, error.message);
        continue;
      }

      const publicUrl = `${supabaseUrl}/storage/v1/object/public/inboxpdf/${att.filename}`;

      uploadedFiles.push({
        filename: att.filename,
        url: publicUrl,
      });

      console.log(`✅ Succesvol geüpload: ${att.filename}`);
    } catch (err) {
      console.error(`💥 Fout bij upload van ${att.filename}:`, err.message || err);
    }
  }

  console.log(`📤 Totaal succesvol geüpload: ${uploadedFiles.length}`);
  return uploadedFiles;
}