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
    const bestandsnaam = `Order_${data.ritnummer || 'GEEN_RITNUMMER'}.easy`;
    const localPath = path.join('/tmp', bestandsnaam);
    fs.writeFileSync(localPath, xml, 'utf8');

    const originelePdfNaam = data.pdfBestandsnaam || 'backup.pdf';
    // 📥 PDF ophalen uit Supabase
    const { data: downloadData, error: downloadError } = await supabase
     .storage
     .from('inboxpdf') // ✅ correcte bucket
     .download(originelePdfNaam);

    let originelePdfBuffer = null;

    if (downloadError) {
      console.warn(`⚠️ PDF niet gevonden in Supabase: ${downloadError.message}`);
    } else {
      originelePdfBuffer = Buffer.from(await downloadData.arrayBuffer());
      console.log(`✅ PDF gedownload uit Supabase: ${originelePdfNaam}`);
    }

    // 📤 Upload XML + PDF naar Supabase
    const uploads = await uploadPdfAttachmentsToSupabase([
  {
    filename: bestandsnaam,
    content: fs.readFileSync(localPath),
    contentType: 'application/xml',
    ritnummer: data.ritnummer,
    skipReprocessing: true, // ✅ voorkomt dubbele verwerking
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
  skipReprocessing: true, // ✅ voorkomt dubbele verwerking
  emailMeta: {
    from: 'Easytrip Automator',
    subject: `Originele opdracht PDF voor ${data.ritnummer}`,
    received: new Date().toISOString(),
    attachments: [originelePdfNaam]
  }
}] : [])
]);
    // 📧 Verstuur e-mail
    const emailAttachments = [
  { filename: bestandsnaam, path: localPath }
];

if (originelePdfBuffer) {
  emailAttachments.push({
    filename: originelePdfNaam,
    content: originelePdfBuffer
  });
} else {
  console.warn('⚠️ PDF buffer niet beschikbaar, dus niet toegevoegd aan e-mail');
}

await sendEmailWithAttachments({
  ritnummer: data.ritnummer,
  attachments: [
    { filename: bestandsnaam, path: localPath },  // .easy-bestand
    ...(originelePdfBuffer ? [{
      filename: originelePdfNaam,                // originele pdf naam
      content: originelePdfBuffer                // pdf inhoud
    }] : [])
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