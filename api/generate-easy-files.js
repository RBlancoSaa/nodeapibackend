import { createClient } from '@supabase/supabase-js';
import { parsePdfToEasyFile } from '../services/parsePdfToEasyFile.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 📥 Haal lijst van PDF-bestanden op uit 'inboxpdf'
    const { data: files, error: listError } = await supabase.storage
      .from('inboxpdf')
      .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

    if (listError) throw new Error('Fout bij ophalen bestandslijst: ' + listError.message);
    if (!files || files.length === 0) return res.status(200).json({ success: true, message: 'Geen PDF-bestanden gevonden.' });

    const generatedFiles = [];

    for (const file of files) {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('inboxpdf')
        .download(file.name);

      if (downloadError) {
        console.error(`❌ Download mislukt voor ${file.name}:`, downloadError.message);
        continue;
      }

      const pdfBuffer = Buffer.from(await fileData.arrayBuffer());

      let easyContent;
      try {
        easyContent = await parsePdfToEasyFile(Buffer.from(pdfBuffer));
      } catch (err) {
        console.error(`❌ Parserfout voor ${file.name}:`, err.message);
        continue;
      }

      const easyFilename = file.name.replace(/\.pdf$/, '.easy');
      const { error: uploadError } = await supabase.storage
        .from('easyfiles')
        .upload(easyFilename, easyContent, {
          contentType: 'text/plain',
          upsert: true,
        });

      if (uploadError) {
        console.error(`❌ Upload .easy mislukt voor ${easyFilename}:`, uploadError.message);
        continue;
      }

      console.log(`✅ Easy file gegenereerd: ${easyFilename}`);
      generatedFiles.push(easyFilename);
    }

    return res.status(200).json({
      success: true,
      total: files.length,
      generated: generatedFiles.length,
      easyFiles: generatedFiles,
    });

  } catch (error) {
    console.error('💥 Serverfout:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}