import fs from 'fs';
import path from 'path';
import { supabase } from '../services/supabaseClient.js';

export default async function handler(req, res) {
  console.log("✅ API route /api/generate-easy-files wordt aangeroepen");
  console.log("🕒 Tijdstip:", new Date().toISOString());

  try {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const rawBody = Buffer.concat(buffers).toString();

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (err) {
      console.warn("⚠️ Ongeldige JSON ontvangen:", rawBody);
      return res.status(400).json({ success: false, message: 'Body is geen geldige JSON' });
    }

    console.log("📦 Volledige body ontvangen:", body);

    const { xml, reference, laadplaats } = body;

    if (!xml || !reference || !laadplaats) {
      console.warn("❌ Verplichte velden ontbreken:", { xml, reference, laadplaats });
      return res.status(400).json({ success: false, message: 'xml, reference of laadplaats ontbreekt.' });
    }

    const fileName = `Order_${reference}_${laadplaats}.easy`;

    const { error } = await supabase.storage
      .from('easyfiles')
      .upload(fileName, xml, {
        contentType: 'text/plain',
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error("❌ Fout bij uploaden naar Supabase:", error.message);
      return res.status(500).json({ success: false, message: 'Upload naar Supabase mislukt' });
    }

    console.log("✅ Easy file succesvol geüpload:", fileName);
    return res.status(200).json({ success: true, fileName });
  } catch (err) {
    console.error("🧨 Onverwachte fout in generate-easy-files.js:", err);
    return res.status(500).json({ success: false, message: 'Interne serverfout.' });
  }
}