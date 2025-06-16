// 📁 automatinglogistics-api/services/uploadPdfAttachmentsToSupabase.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Uploadt PDF-bestanden naar Supabase Storage uit een array met attachments.
 * @param {Array} attachments - Een array van objecten met { uid, filename, contentType, content }
 * @returns {Array} uploadedFiles - Met filename en publieke URL
 */
export async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

  for (const att of attachments) {
    if (!att.filename?.toLowerCase().endsWith('.pdf')) continue;

    console.log(`➡️ Uploaden: ${att.filename}`);
    console.log(`📂 Grootte: ${att.content?.length ?? 'onbekend'} bytes`);
    console.log(`📂 Is Buffer: ${Buffer.isBuffer(att.content)}`);

    if (!att.content || !Buffer.isBuffer(att.content)) {
      console.error(`⛔ Ongeldige buffer voor ${att.filename}`);
      continue;
    }

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

    uploadedFiles.push({
      filename: att.filename,
      url: `${supabaseUrl}/storage/v1/object/public/inboxpdf/${att.filename}`
    });

    console.log(`✅ Succesvol geüpload: ${att.filename}`);
  }

  return uploadedFiles;
}