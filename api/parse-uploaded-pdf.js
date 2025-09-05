// 📁 /api/parse-uploaded-pdf.js
import '../utils/fsPatch.js';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import parsePdfToJson from '../services/parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ success: false, message: 'Geen bestandsnaam opgegeven' });
  }

  // 1. Download PDF uit Supabase
  const { data: pdfData, error } = await supabase.storage.from('inboxpdf').download(filename);
  if (error) {
    console.error('❌ Fout bij downloaden PDF:', error.message);
    return res.status(500).json({ success: false, message: 'Fout bij downloaden PDF' });
  }

  // 2. Parse naar JSON
  const parsedData = await parsePdfToJson(pdfData);
  if (!parsedData || Object.keys(parsedData).length === 0) {
    console.warn('⚠️ Parser leverde geen data op');
    return res.status(200).json({ success: false, message: 'Parser gaf geen resultaat terug' });
  }

  // 3. Genereer XML
  const xml = await generateXmlFromJson(parsedData);

  // 4. Sla op als .easy in /tmp
  const reference = parsedData.referentie || 'GeenReferentie';
  const laadplaats = parsedData.locaties?.[0]?.naam?.replace(/[^\w\s]/gi, '') || 'Onbekend';
  const easyFilename = `Order_${reference}_${laadplaats}.easy`;
  const easyPath = path.join('/tmp', easyFilename);
  fs.writeFileSync(easyPath, xml);

  // 5. Upload .easy naar Supabase
  await uploadPdfAttachmentsToSupabase([
    { filename: easyFilename, content: fs.readFileSync(easyPath) }
  ]);

  // 6. Verstuur e-mail met bijlage
  await sendEmailWithAttachments({
    reference,
    filePath: easyPath,
    filename: easyFilename
  });

  // 7. Bevestiging
  return res.status(200).json({
    success: true,
    message: 'PDF verwerkt en .easy verzonden',
    filename: easyFilename
  });
}