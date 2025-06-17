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

    const safeFilename = att.filename
  .normalize('NFKD')
  .replace(/[^\w\d\-_.]/g, '_')
  .replace(/_+/g, '_');

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
      console.error(`❌ Buffer error (${safeFilename}):`, err.message);
      continue;
    }

    if (!contentBuffer?.length) {
      console.error(`⛔ Lege buffer voor ${safeFilename}`);
      continue;
    }

    try {
      const { error } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(safeFilename, contentBuffer, {
          contentType: att.contentType || 'application/pdf',
          cacheControl: '3600',
          upsert: true,
        });

      if (error) {
        console.error(`❌ Uploadfout: Invalid key: ${safeFilename}`);
        continue;
      }

      console.log(`✅ Upload gelukt: ${safeFilename}`);

      let xml;
      try {
        xml = await parsePdfToEasyFile(contentBuffer);
      } catch (err) {
        console.error(`⚠️ Parserfout voor ${safeFilename}:`, err.message);
        continue;
      }

      const referenceMatch = xml.match(/<Klantreferentie>(.*?)<\/Klantreferentie>/);
      const laadplaatsMatch = xml.match(/<Naam>(.*?)<\/Naam>/);

      const reference = referenceMatch?.[1] || 'Onbekend';
      const laadplaats = laadplaatsMatch?.[1] || 'Onbekend';

      const payload = {
        xml,
        reference,
        laadplaats
      };

      console.log("📤 Versturen naar generate-easy-files met body:", JSON.stringify(payload, null, 2));

      const resp = await fetch(`${process.env.PUBLIC_URL}/api/generate-easy-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const responseText = await resp.text();
      console.log("📥 Response van generate-easy-files:", responseText);

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        result = { success: false, message: 'Kon response niet parsen als JSON' };
      }

      if (!result.success) {
        console.error(`⚠️ .easy genereren mislukt voor ${safeFilename}:`, result.message);
      } else {
        console.log(`✅ .easy gegenereerd voor ${safeFilename}:`, result.fileName);
      }

      uploadedFiles.push({
        filename: safeFilename,
        url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${safeFilename}`
      });
    } catch (err) {
      console.error(`💥 Upload/parsing fout voor ${safeFilename}:`, err.message || err);
    }
  }

  return uploadedFiles;
}