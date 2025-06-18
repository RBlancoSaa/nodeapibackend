import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// nodeapibackend/api/generate-easy-files.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    // haal JSON data uit req.body of Supabase file
    const jsonData = req.body;

    // roep parser aan
    const xmlString = await generateXmlFromJson(jsonData); // of de juiste service
    // evt. upload .easy naar Supabase

    return res.status(200).json({ success: true, xml: xmlString });
  } catch (error) {
    console.error("❌ Fout bij XML generatie:", error);
    return res.status(500).json({ success: false, message: 'XML generatie mislukt' });
  }
}

    console.log("📦 xmlBase64 ontvangen:", xmlBase64.substring(0, 80) + '...');
    const xml = Buffer.from(xmlBase64, 'base64').toString('utf8');
    console.log("📄 Gedecodeerde XML:", xml.substring(0, 200) + '...');

    const filename = `Order_${reference}_${laadplaats}.easy`;
    const tempDir = '/tmp';
    const filePath = path.join(tempDir, filename);

    fs.writeFileSync(filePath, xml);

    console.log("💾 Klaar om op te slaan:", filename);
    console.log("📁 Bestandspad:", filePath);

    const { error } = await supabase.storage
      .from(process.env.SUPABASE_EASY_BUCKET)
      .upload(filename, fs.readFileSync(filePath), {
        contentType: 'text/plain',
        upsert: true
      });

    if (error) {
      console.error('❌ Uploadfout:', error.message);

      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: process.env.FROM_EMAIL,
        subject: `FOUT: .easy upload voor ${filename}`,
        text: `Er ging iets mis bij het uploaden van ${filename}:\n\n${error.message}`
      });

      return res.status(500).json({ success: false, message: 'Upload naar Supabase mislukt' });
    }

    const downloadUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_EASY_BUCKET}/${filename}`;
    console.log(`✅ .easy bestand opgeslagen als: ${filename}`);

    const mailOptions = {
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
    };

    console.log("✉️ Verstuur e-mail met bijlage:", filename);
    await transporter.sendMail(mailOptions);

    return res.status(200).json({
      success: true,
      fileName: filename,
      downloadUrl
    });

  } catch (err) {
    console.error('💥 Onverwachte fout in generate-easy-files:', err.message || err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Serverfout'
    });
  }
}