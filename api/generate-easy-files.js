import fs from 'fs';
import path from 'path';
import { supabase } from '../services/supabaseClient.js';
import { generateEasyXML } from '../services/easyFileService.js';

export default async function handler(req, res) {
  try {
    const { pdfData, reference, laadplaats } = req.body;

    console.log("🚀 .easy generator aangeroepen");
    if (!pdfData || !reference || !laadplaats) {
      console.error("❌ Verplichte velden ontbreken:", { pdfData, reference, laadplaats });
      return res.status(400).json({ success: false, message: 'pdfData, reference of laadplaats ontbreekt.' });
    }

    const easyContent = generateEasyXML(pdfData);
    if (!easyContent || typeof easyContent !== 'string') {
      console.error("❌ .easy bestand is leeg of ongeldig.");
      return res.status(500).json({ success: false, message: 'Leeg .easy bestand gegenereerd.' });
    }

    const fileName = `Order_${reference}_${laadplaats}.easy`;
    const fileBuffer = Buffer.from(easyContent, 'utf-8');

    const { error: uploadError } = await supabase.storage
      .from('easyfiles')
      .upload(fileName, fileBuffer, {
        contentType: 'text/plain',
        upsert: true
      });

    if (uploadError) {
      console.error("❌ Upload naar Supabase mislukt:", uploadError.message);
      return res.status(500).json({ success: false, message: 'Upload naar Supabase mislukt.', error: uploadError.message });
    }

    console.log(`✅ .easy bestand succesvol opgeslagen als ${fileName}`);
    return res.status(200).json({ success: true, fileName });
  } catch (err) {
    console.error("❌ Interne fout in generate-easy-files.js:", err);
    return res.status(500).json({ success: false, message: 'Interne fout in .easy generator.' });
  }
}