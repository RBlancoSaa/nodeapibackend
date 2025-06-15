// services/supabaseStorageService.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function uploadPdfAttachmentsToSupabase(client, mails) {
  const uploadedFiles = [];

  for (const mail of mails) {
    for (const part of mail.pdfParts) {
      const attachment = await client.download(mail.uid, part);
      const filename = `pdf-${mail.uid}-${part}.pdf`;

      // Upload naar Supabase Storage
      const { data, error } = await supabase.storage
        .from('pdf-attachments')
        .upload(filename, attachment, {
          cacheControl: '3600',
          upsert: true,
          contentType: 'application/pdf',
        });

      if (error) {
        console.error('Upload error:', error);
        continue;
      }

      uploadedFiles.push({ filename, url: data?.path });
    }
  }

  return uploadedFiles;
}
