// 📁 /api/parse-uploaded-pdf.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import parsePdfToJson from '../services/parsePdfToJson.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

let _supabase;
function getSupabase() {
  return _supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ success: false, message: 'Geen bestandsnaam opgegeven' });
  }

  // 1. Download PDF uit Supabase
  console.log('🔗 Supabase URL:', process.env.SUPABASE_URL);
  console.log('🔑 Key lengte:', process.env.SUPABASE_SERVICE_ROLE_KEY?.length);
  console.log('🔑 Key start:', process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 20));
  console.log('📥 Downloading:', filename);

  const { data: buckets, error: bErr } = await getSupabase().storage.listBuckets();
  console.log('📦 Buckets zichtbaar:', JSON.stringify(buckets?.map(b => b.id)), '| Error:', JSON.stringify(bErr));

  const { data: pdfBlob, error } = await getSupabase().storage.from('inboxpdf').download(filename);
  if (error) {
    console.error('❌ Fout bij downloaden PDF:', JSON.stringify(error));
    return res.status(500).json({ success: false, message: 'Fout bij downloaden PDF' });
  }

  const pdfData = Buffer.from(await pdfBlob.arrayBuffer());

  // 2. Parse naar JSON
  const parsedContainers = await parsePdfToJson(pdfData);
  if (!parsedContainers || !Array.isArray(parsedContainers) || parsedContainers.length === 0) {
    console.warn('⚠️ Parser leverde geen data op');
    return res.status(200).json({ success: false, message: 'Parser gaf geen resultaat terug' });
  }

  const processedFiles = [];
  for (const container of parsedContainers) {
    const xml = await generateXmlFromJson(container);
    const reference = (container.referentie && container.referentie !== '0') ? container.referentie : (container.ritnummer || 'GeenReferentie');
    const laadplaats = container.locaties?.[1]?.naam?.replace(/[^\w\s]/gi, '') || container.locaties?.[0]?.naam?.replace(/[^\w\s]/gi, '') || 'Onbekend';
    const easyFilename = `Order_${reference}_${laadplaats}.easy`;
    const easyPath = path.join(os.tmpdir(), easyFilename);
    fs.writeFileSync(easyPath, xml);
    processedFiles.push(easyFilename);

    await uploadPdfAttachmentsToSupabase([
      { filename: easyFilename, content: fs.readFileSync(easyPath) }
    ]);

    await sendEmailWithAttachments({
      ritnummer: container.ritnummer || reference,
      attachments: [{ filename: easyFilename, path: easyPath }],
      verwerkingsresultaten: [{ filename: easyFilename, parsed: true }]
    });
  }

  // 7. Bevestiging
  return res.status(200).json({
    success: true,
    message: 'PDF verwerkt en .easy verzonden',
    filenames: processedFiles
  });
}