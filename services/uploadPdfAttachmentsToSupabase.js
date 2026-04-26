// 📁 services/uploadPdfAttachmentsToSupabase.js
import '../utils/fsPatch.js';
import { createClient } from '@supabase/supabase-js';

let _supabase;
function getSupabase() {
  return _supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

  const sanitizedAttachments = attachments.map(att => ({
    ...att,
    filename: (att.filename || 'bijlage')
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[^\w\d\-_.]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
  }));

  for (const att of sanitizedAttachments) {
    let contentBuffer;
    try {
      if (Buffer.isBuffer(att.content)) {
        contentBuffer = att.content;
      } else if (att.content instanceof Uint8Array) {
        contentBuffer = Buffer.from(att.content);
      } else if (att.content instanceof ArrayBuffer) {
        contentBuffer = Buffer.from(new Uint8Array(att.content));
      } else {
        throw new Error('Attachment is geen geldige buffer');
      }
    } catch (err) {
      console.error(`❌ Buffer fout voor ${att.filename}:`, err.message);
      continue;
    }

    if (!contentBuffer?.length) {
      console.error(`⛔ Lege buffer voor ${att.filename}`);
      continue;
    }

    const bucket = att.filename.endsWith('.easy') ? 'easyfiles' : 'inboxpdf';

    try {
      const { error } = await getSupabase()
        .storage
        .from(bucket)
        .upload(att.filename, contentBuffer, {
          contentType: att.contentType || 'application/octet-stream',
          upsert: true
        });

      if (error) {
        console.error(`❌ Supabase upload fout voor ${att.filename}:`, error.message);
        continue;
      }

      uploadedFiles.push({ filename: att.filename, content: contentBuffer });
      console.log(`✅ Geüpload naar Supabase (${bucket}): ${att.filename}`);
    } catch (err) {
      console.error(`❌ Uploadfout voor ${att.filename}:`, err.message);
    }
  }

  return uploadedFiles;
}
