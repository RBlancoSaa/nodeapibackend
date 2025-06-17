import fs from 'fs';
import path from 'path';
import { supabase } from '../services/supabaseClient.js';
import { generateEasyXML } from '../services/easyFileService.js';

export default async function handler(req, res) {
  console.log("✅ API route /api/generate-easy-files wordt aangeroepen");
  console.log("🕒 Tijdstip:", new Date().toISOString());

  try {
    // Logging inkomende data
    console.log("📦 Volledige req.body:", req.body);
if (!req.body) {
  console.warn("⚠️ Request zonder body ontvangen");
  return res.status(400).json({ success: false, message: 'Ontbrekende body' });
}
    const { pdfData, reference, laadplaats } = req.body;

    console.log("🔍 Ontvangen waarden:");
    console.log("    - reference:", reference);
    console.log("    - laadplaats:", laadplaats);
    console.log("    - pdfData type:", typeof pdfData);
    if (pdfData && typeof pdfData === 'string') {
      console.log("    - pdfData lengte:", pdfData.length);
      console.log("    - eerste 100 tekens:", pdfData.slice(0, 100));
    }

    // Controleren op ontbrekende velden
    if (!pdfData || !reference || !laadplaats) {
      console.error("❌ Ontbrekende velden:", { pdfData, reference, laadplaats });
      return res.status(400).json({ success: false, message: 'pdfData, reference of laadplaats ontbreekt.' });
    }

    // .env check
    console.log("🌍 SUPABASE_URL:", process.env.SUPABASE_URL || '⚠️ NIET GEDEFINIEERD');
    console.log("🔐 SUPABASE_SERVICE_ROLE_KEY aanwezig:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Aanroepen van generator
    const easyContent = generateEasyXML(pdfData);
    console.log("🧠 EasyXML gegenereerd");
    if (!easyContent || typeof easyContent !== 'string') {
      console.error("❌ gegenereerd easyContent is ongeldig of leeg");
      return res.status(500).json({ success: false, message: 'Leeg of ongeldig .easy bestand gegenereerd.' });
    }

    console.log("📄 EasyXML preview:", easyContent.slice(0, 300));

    // Uploaden naar Supabase
    const fileName = `Order_${reference}_${laadplaats}.easy`;
    const fileBuffer = Buffer.from(easyContent, 'utf-8');

    console.log("💾 Voorbereid voor upload:");
    console.log("    - bestandsnaam:", fileName);
    console.log("    - grootte (bytes):", fileBuffer.length);

    const { error: uploadError } = await supabase.storage
      .from('easyfiles')
      .upload(fileName, fileBuffer, {
        contentType: 'text/plain',
        upsert: true
      });

    if (uploadError) {
      console.error("🚨 Upload naar Supabase mislukt:", uploadError.message);
      return res.status(500).json({ success: false, message: 'Upload naar Supabase mislukt.', error: uploadError.message });
    }

    console.log(`✅ Upload succesvol: ${fileName}`);
    return res.status(200).json({ success: true, fileName });
  } catch (err) {
    console.error("🧨 Onverwachte fout in generate-easy-files.js:", err);
    return res.status(500).json({ success: false, message: 'Interne serverfout.' });
  }
}