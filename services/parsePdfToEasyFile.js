// 📁 parsePdfToEasyFile.js
import '../utils/fsPatch.js';
import { createClient } from '@supabase/supabase-js';
import parsePdfToJson from './parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parsePdfToEasyFile...');

  const parsedContainers = await parsePdfToJson(pdfBuffer);

  if (!Array.isArray(parsedContainers) || parsedContainers.length === 0) {
    console.warn('⛔️ Geen containers gevonden in parserdata');
    return [];
  }

  const xmlFiles = [];

  for (const containerData of parsedContainers) {
    try {
      console.log('📦 XML input per container:', JSON.stringify(containerData, null, 2));
      const xml = await generateXmlFromJson(containerData);

      // ✅ XML-bestand opslaan in Supabase bucket
      const filename = `Order_${containerData.referentie || uuidv4()}_${containerData.locaties?.[0]?.plaats || 'onbekend'}.easy`;

      const { error: uploadError } = await supabase.storage
        .from('easytrip_files')
        .upload(`temp.easy/${filename}`, Buffer.from(xml), {
          contentType: 'application/xml',
          upsert: true
        });

      if (uploadError) {
        console.error(`❌ Upload naar Supabase gefaald voor ${filename}:`, uploadError.message);
      } else {
        console.log(`☁️ XML opgeslagen in Supabase: ${filename}`);
      }

      xmlFiles.push({
        filename,
        content: xml
      });

    } catch (err) {
      console.error(`❌ Fout tijdens XML-generatie voor container ${containerData.containernummer || '[onbekend]'}`, err.message);
    }
  }

  console.log(`✅ Aantal XML-bestanden gegenereerd: ${xmlFiles.length}`);
  return xmlFiles;
}