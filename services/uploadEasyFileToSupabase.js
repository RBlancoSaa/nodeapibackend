// services/uploadEasyFileToSupabase.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function uploadEasyFileToSupabase({ filename, fileContent }) {
  const buffer = Buffer.from(fileContent, 'utf-8');
  const { error } = await supabase.storage
    .from('easyfiles')
    .upload(filename, buffer, {
      contentType: 'application/xml',
      upsert: true
    });

  if (error) throw new Error(`❌ Supabase upload mislukt voor ${filename}: ${error.message}`);
}