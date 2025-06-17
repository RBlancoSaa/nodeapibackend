import { createClient } from '@supabase/supabase-js';
import { parsePdfToEasyFile } from './parsePdfToEasyFile.js';
import fetch from 'node-fetch';

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

    let contentBuffer;
    try {
      if (Buffer.isBuffer(att.content)) {
        contentBuffer = att.content;
      } else if (att.content instanceof Uint8Array) {
        contentBuffer = Buffer.from(att.content);
      } else if (att.content instanceof ArrayBuffer) {
        contentBuffer = Buffer.from(new Uint8Array(att.content));
      } else {
        throw new Error('Attachment content is not een buffer');
      }
    } catch (err) {
      console.error(`❌ Buffer error (${att.filename}):`, err.message);
      continue;
    }

    if (!contentBuffer?.length) {
      console.error(`⛔ Lege buffer voor ${att.filename}`);
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
        console.error(`❌ Uploadfout (${att.filename}):`, error.message);
        continue;
      }

      const parsedData = await parsePdfToEasyFile(contentBuffer);
      const laadplaats = parsedData.laadplaats || 'Onbekend';

      // Post naar generate-easy-files
      const resp = await fetch(`${process.env.PUBLIC_URL}/api/generate-easy-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfData: parsedData,
          reference: parsedData.klantreferentie,
          laadplaats
        })
      });

      const result = await resp.json();
      if (!result.success) {
        console.error(`⚠️ .easy genereren mislukt voor ${att.filename}:`, result.message);
      } else {
        console.log(`✅ .easy gegenereerd voor ${att.filename}:`, result.fileName);
      }

      uploadedFiles.push({
        filename: att.filename,
        url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${att.filename}`
      });
    } catch (err) {
      console.error(`💥 Upload/parsing fout voor ${att.filename}:`, err.message || err);
    }
  }

  return uploadedFiles;
}