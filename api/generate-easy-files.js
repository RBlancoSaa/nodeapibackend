// 📁 /api/generate-easy-files.js
import '../utils/fsPatch.js';
import fs from 'fs';
import path from 'path';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const data = req.body;

    // Alleen waarschuwingen — niet blokkeren
    const verplichteVelden = ['datum', 'tijd', 'containertypeCode', 'laadplaats'];
    for (const veld of verplichteVelden) {
      if (!data[veld] || data[veld] === '0') {
        console.warn(`⚠️ Ontbrekend veld: ${veld}`);
      }
    }
    if (!data.opdrachtgeverNaam || data.opdrachtgeverNaam === '0') {
    console.warn('⚠️ Geen opdrachtgevergegevens ingevuld – bestand wordt wel gegenereerd');
    }

    if (!data.klantBedrijf && !data.klantnaam) {
      console.warn('⚠️ Ontbrekende klantnaam');
    }
    

    const xml = await generateXmlFromJson(data);
    const bestandsnaam = `Order_${data.reference || 'GEEN_REF'}.easy`;
    const localPath = path.join('/tmp', bestandsnaam);
    fs.writeFileSync(localPath, xml, 'utf8');


    // PDF ophalen uit Supabase
    const originelePdfNaam = data.pdfBestandsnaam || `origineel_${data.reference}.pdf`;
    let originelePdfBuffer = null;

    const { data: downloadData, error: downloadError } = await supabase
      .storage
      .from(process.env.SUPABASE_BUCKET)
      .download(originelePdfNaam);

    if (downloadError) {
      console.warn(`⚠️ PDF niet gevonden in Supabase: ${downloadError.message}`);
    } else {
      originelePdfBuffer = Buffer.from(await downloadData.arrayBuffer());
      console.log(`✅ PDF gedownload uit Supabase: ${originelePdfNaam}`);
    }

    
     await uploadPdfAttachmentsToSupabase([
  {
    filename: bestandsnaam,
    content: fs.readFileSync(localPath),
    contentType: 'application/xml',
    ritnummer: data.ritnummer,
    emailMeta: {
      from: 'Easytrip Automator',
      subject: `XML voor ${bestandsnaam}`,
      received: new Date().toISOString(),
      attachments: [bestandsnaam]
    }
  },
  ...(originelePdfBuffer ? [{
    filename: originelePdfNaam,
    content: originelePdfBuffer,
    contentType: 'application/pdf',
    ritnummer: data.ritnummer,
    emailMeta: {
      from: 'Easytrip Automator',
      subject: `Originele opdracht PDF voor ${data.reference}`,
      received: new Date().toISOString(),
      attachments: [originelePdfNaam]
    }
  }] : [])
], data.ritnummer);

     await sendEmailWithAttachments({
      reference: data.reference,
      attachments: [
        { filename: bestandsnaam, path: localPath },
        ...(originelePdfBuffer ? [{ filename: originelePdfNaam, content: originelePdfBuffer }] : [])
      ]
    });

    return res.status(200).json({
      success: true,
      filename: bestandsnaam,
      uploadedCount: uploads.length,
      filenames: uploads.map(u => u.filename)
    });

  } catch (error) {
    console.error('💥 Fout bij genereren .easy-bestand:', error);
    return res.status(500).json({ success: false, message: error.message || 'Onbekende fout' });
  }
}