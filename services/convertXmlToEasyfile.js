import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function convertXmlToEasyfile(xml, outputPath) {
  try {
    fs.writeFileSync(outputPath, xml, 'utf8');
    console.log('💾 Bestand opgeslagen op pad:', outputPath);

    const filename = outputPath.split('/').pop();
    const { error } = await supabase.storage.from('easyfiles').upload(filename, fs.readFileSync(outputPath), {
      cacheControl: '3600',
      upsert: true,
      contentType: 'application/xml'
    });

    if (error) throw new Error(error.message);

    console.log('☁️ Bestand geüpload naar Supabase:', filename);
  } catch (err) {
    console.error('❌ Fout bij converteren naar .easy:', err.message);
    throw err;
  }
}