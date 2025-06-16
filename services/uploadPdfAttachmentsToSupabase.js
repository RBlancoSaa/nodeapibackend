// 📁 nodeapibackend/services/uploadPdfAttachmentsToSupabase.js

import { createClient } from '@supabase/supabase-js';

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

  console.log('🚀 Start upload naar Supabase');
  console.log('🔑 KEY lengte:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length);
  console.log('🪣 Bucket:', process.env.SUPABASE_BUCKET);
  console.log('📦 Aantal attachments ontvangen:', attachments?.length ?? 'undefined');

  if (!attachments || attachments.length === 0) {
    console.error('❌ Geen attachments ontvangen in uploadfunctie');
    return [];
  }

  for (const att of attachments) {
    console.log(`\n🧪 Upload attempt: ${att.filename} | Type: ${att.contentType} | UID: ${att.uid}`);
    console.log('🔍 typeof content:', typeof att.content);
    console.log('🔍 constructor:', att.content?.constructor?.name);

    if (!att.filename) {
      console.warn(`❌ Skip: geen bestandsnaam (UID ${att.uid})`);
      continue;
    }

    let contentBuffer;
    try {
      if (Buffer.isBuffer(att.content)) {
        contentBuffer = att.content;
      } else if (att.content?.constructor?.name === 'Uint8Array') {
        contentBuffer = Buffer.from(att.content);
      } else if (typeof att.content === 'string' && /^[A-Za-z0-9+/=]+$/.test(att.content)) {
        contentBuffer = Buffer.from(att.content, 'base64');
        console.log('⚠️ base64 fallback gebruikt voor', att.filename);
      } else if (att.content?.data) {
        contentBuffer = Buffer.from(att.content.data);
      } else {
        throw new Error('Onbekend contentformaat');
      }

      console.log('📏 Buffer lengte:', contentBuffer.length);
    } catch (err) {
      console.error(`💥 Buffer conversie gefaald voor ${att.filename}:`, err.message);
      continue;
    }

    if (!contentBuffer || contentBuffer.length < 500) {
      console.warn(`⛔ Ongeldige of te kleine buffer (${contentBuffer?.length} bytes) voor ${att.filename}`);
      continue;
    }

    try {
      console.log(`📤 Uploaden naar Supabase: ${att.filename}`);

      const { error } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(att.filename, contentBuffer, {
          contentType: att.contentType || 'application/pdf',
          cacheControl: '3600',
          upsert: true,
        });

      if (error) {
        console.error(`❌ Uploadfout (${att.filename}):`, {
          message: error.message,
          name: error.name,
          stack: error.stack,
        });
        continue;
      }

      const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${att.filename}`;
      uploadedFiles.push({ filename: att.filename, url });

      console.log(`✅ Succesvol geüpload: ${att.filename}`);
    } catch (err) {
      console.error(`💥 Exception bij upload van ${att.filename}:`, err.message || err);
    }
  }

  console.log(`📤 Upload afgerond. Aantal successen: ${uploadedFiles.length}`);
  return uploadedFiles;
}