// 📁 services/uploadPdfAttachmentsToSupabase.js

import { supabase } from '../utils/supabaseClient.js';
import { parsePdfToEasyFile } from './parsePdfToEasyFile.js';
import notifyError from '../utils/notifyError.js';

export default async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

  console.log('📥 Start uploadPdfAttachmentsToSupabase');
  console.log(`📎 Aantal bijlagen ontvangen: ${attachments.length}`);

  const sanitizedAttachments = attachments.map(att => ({
    ...att,
    originalFilename: att.filename,
    filename: att.filename
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[^\w\d\-_.]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
  }));

  console.log('🔍 Geschoonde bestandsnamen:', sanitizedAttachments.map(a => a.filename));

  for (const att of sanitizedAttachments) {
    try {
      console.log(`📤 Upload naar Supabase: ${att.filename}`);

      const contentBuffer = Buffer.isBuffer(att.content)
        ? att.content
        : Buffer.from(att.content, 'base64');

      const { error: uploadError } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(att.filename, contentBuffer, {
          contentType: att.contentType || 'application/pdf',
          upsert: true
        });

      if (uploadError) {
        const msg = `❌ Uploadfout voor ${att.filename}: ${uploadError.message}`;
        console.error(msg);
        await notifyError(att, msg);
        continue;
      }

      console.log(`✅ Upload gelukt: ${att.filename}`);

      let parsedData;
      try {
        parsedData = await parsePdfToEasyFile(contentBuffer);
        console.log('📄 Parsed data ontvangen:', parsedData);
      } catch (parseError) {
        const msg = `⚠️ Parserfout voor ${att.filename}: ${parseError.message}`;
        console.error(msg);
        await notifyError(att, msg);
        continue;
      }

      const response = await fetch(`${process.env.PUBLIC_URL}/api/generate-easy-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedData)
      });

      const rawText = await response.text();
      console.log('📬 Respons van generate-easy-files:', rawText);

      let result;
      try {
        result = JSON.parse(rawText);
      } catch {
        result = { success: false, message: 'Kon antwoord niet parsen als JSON' };
      }

      if (!result.success) {
        const msg = `⚠️ Easy-bestand fout voor ${att.filename}: ${result.message}`;
        console.error(msg);
        await notifyError(att, msg);
        continue;
      }

      console.log(`✅ Easy-bestand succesvol gegenereerd: ${result.fileName}`);

      uploadedFiles.push({
        filename: att.filename,
        url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${att.filename}`
      });

    } catch (err) {
      const msg = `💥 Upload/parsing crash bij ${att.filename}: ${err.message || err}`;
      console.error(msg);
      await notifyError(att, msg);
    }
  }

  return uploadedFiles;
}