// nodeapibackend/api/generate-easy-files.js

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

// 🔗 Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✉️ E-mail setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// 🚀 API handler
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // 📥 Input
  const data = req.body;
  console.log('📥 Ontvangen JSON in /generate-easy-files:', JSON.stringify(data, null, 2));

  try {
    if (!data || typeof data !== 'object') {
  return res.status(400).json({ success: false, message: 'Ongeldige inputdata ontvangen' });
}
    const reference = data.klantreferentie || 'GeenReferentie';
    const laadplaats = data.laadplaats || 'GeenPlaats';

    // 📄 Genereer XML
    const xml = await generateXmlFromJson(data);
    if (!xml || typeof xml !== 'string') {
      throw new Error('Parser gaf geen geldig XML-bestand terug');
    }
    console.log('🧩 XML gegenereerd');

    // 💾 Tijdelijke opslag
    const filename = `Order_${reference}_${laadplaats}.easy`;
    const tempDir = '/tmp';
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, xml);
    console.log('💾 Bestand opgeslagen op pad:', filePath);

    // ☁️ Upload naar Supabase
    const bucketName = process.env.SUPABASE_EASY_BUCKET;
    if (!bucketName || bucketName.trim() === '') {
      console.error('❌ SUPABASE_EASY_BUCKET ontbreekt of is leeg');
      return res.status(500).json({ success: false, message: 'SUPABASE_EASY_BUCKET ontbreekt of is leeg' });
    }

    const { error } = await supabase.storage
      .from(bucketName)
      .upload(filename, fs.readFileSync(filePath), {
        contentType: 'text/plain',
        upsert: true
      });

    if (error) {
      console.error('❌ Uploadfout naar Supabase:', error.message);
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: process.env.FROM_EMAIL,
        subject: `FOUT: .easy upload voor ${filename}`,
        text: `Upload naar Supabase mislukt:\n\n${error.message}`
      });
      return res.status(500).json({ success: false, message: 'Upload naar Supabase mislukt' });
    }

    const downloadUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucketName}/${filename}`;
    console.log('☁️ Bestand geüpload naar:', downloadUrl);

    // ✉️ E-mail verzenden
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: process.env.FROM_EMAIL,
      subject: `easytrip file - automatisch gegenereerd - ${reference}`,
      text: `In de bijlage vind je het gegenereerde Easytrip-bestand voor referentie: ${reference}`,
      attachments: [
        {
          filename,
          content: fs.readFileSync(filePath)
        }
      ]
    });
    console.log('📧 Mail verzonden');

    // ✅ Antwoord
    return res.status(200).json({
      success: true,
      fileName: filename,
      downloadUrl
    });

  } catch (err) {
    console.error('💥 Fout in generate-easy-files:', err.message || err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Serverfout'
    });
  }
}