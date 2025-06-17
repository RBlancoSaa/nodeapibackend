import { createClient } from '@supabase/supabase-js';
import { parsePdfToEasyFile } from './parsePdfToEasyFile.js';
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

  // 🔐 Bestandsnamen standaard opschonen vóór verwerking
  const sanitizedAttachments = attachments.map(att => ({
    ...att,
    originalFilename: att.filename,
    filename: att.filename
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')      // verwijder niet-ASCII
      .replace(/[^\w\d\-_.]/g, '_')      // vervang ongewenste tekens
      .replace(/_+/g, '_')               // meerdere underscores → één
  }));

  for (const att of sanitizedAttachments) {
    if (!att.filename?.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Bestand overgeslagen (geen .pdf): ${att.filename}`);
      continue;
    }

    console.log(`🧾 Bestandsnaam: ${att.originalFilename} → ${att.filename}`);

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
        console.error(`❌ Uploadfout: Invalid key: ${att.filename}`);
        continue;
      }

      console.log(`✅ Upload gelukt: ${att.filename}`);

      let xml;
      try {
        xml = await parsePdfToEasyFile(contentBuffer);
      } catch (err) {
        console.error(`⚠️ Parserfout voor ${att.filename}:`, err.message);
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