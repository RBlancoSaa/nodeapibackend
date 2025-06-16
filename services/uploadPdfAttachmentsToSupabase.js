import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

  for (const att of attachments) {
    if (!att.filename?.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Bestand overgeslagen (geen .pdf): ${att.filename}`);
      continue;
    }

    // Forceer Buffer, ongeacht het type
    let contentBuffer;
    try {
      if (Buffer.isBuffer(att.content)) {
        contentBuffer = att.content;
      } else if (att.content instanceof Uint8Array) {
        contentBuffer = Buffer.from(att.content);
      } else if (att.content instanceof ArrayBuffer) {
        contentBuffer = Buffer.from(new Uint8Array(att.content));
      } else {
        throw new Error('Attachment content is not a Buffer, Uint8Array of ArrayBuffer');
      }
    } catch (err) {
      console.error(`❌ Kan buffer niet maken van ${att.filename}:`, err.message);
      continue;
    }

    console.log('🔄 Upload attempt:', {
      filename: att.filename,
      contentType: att.contentType,
      bufferLength: contentBuffer.length,
      isBuffer: Buffer.isBuffer(contentBuffer)
    });

    if (!contentBuffer || !contentBuffer.length) {
      console.error(`⛔ Ongeldige of lege buffer voor ${att.filename}`);
      continue;
    }

    try {
      const { error } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(att.filename, contentBuffer, {
          contentType: att.contentType || 'application/pdf',
          cacheControl: '3600',
          upsert: true,
        });

      if (error) {
        console.error(`❌ Uploadfout (${att.filename}):`, error.message, error);
        continue;
      }

      const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${att.filename}`;
      uploadedFiles.push({
        filename: att.filename,
        url: publicUrl,
      });

      console.log(`✅ Succesvol geüpload: ${att.filename}`);
    } catch (err) {
      console.error(`💥 Fout bij upload van ${att.filename}:`, err.message || err);
    }
  }

  return uploadedFiles;
}