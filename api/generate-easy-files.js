// 📁 /api/generate-easy-files.js
import '../utils/fsPatch.js';
import fs from 'fs';
import path from 'path';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const data = req.body;

    const verplichteVelden = [
      'opdrachtgeverNaam', 'opdrachtgeverAdres', 'opdrachtgeverPostcode', 'opdrachtgeverPlaats',
      'opdrachtgeverEmail', 'opdrachtgeverBTW', 'opdrachtgeverKVK', 'reference', 'laadplaats'
    ];
    const ontbrekend = verplichteVelden.filter(v => !data[v]);
    if (ontbrekend.length) {
      return res.status(400).json({ success: false, message: `Ontbrekende velden: ${ontbrekend.join(', ')}` });
    }

    const xml = await generateXmlFromJson(data);
    const bestandsnaam = `Order_${data.reference}_${data.laadplaats}.easy`;
    const localPath = path.join('/tmp', bestandsnaam);

    fs.writeFileSync(localPath, xml, 'utf8');

    const originelePdfNaam = data.pdfBestandsnaam || `origineel_${data.reference}.pdf`;
    const padOriginelePdf = path.join('/tmp', originelePdfNaam);
 
    // ⬆️ Beide bestanden uploaden naar Supabase
    await uploadPdfAttachmentsToSupabase([
      {
        filename: bestandsnaam,
        content: fs.readFileSync(localPath),
        contentType: 'application/xml',
        emailMeta: {
          from: 'Easytrip Automator',
          subject: `XML voor ${bestandsnaam}`,
          received: new Date().toISOString(),
          attachments: [bestandsnaam]
        }
      },
      {
        filename: originelePdfNaam,
        content: fs.readFileSync(padOriginelePdf),
        contentType: 'application/pdf',
        emailMeta: {
          from: 'Easytrip Automator',
          subject: `Originele opdracht PDF voor ${data.reference}`,
          received: new Date().toISOString(),
          attachments: [originelePdfNaam]
        }
      }
    ]);

    // ✅ Verstuur mail met beide bijlagen
    await sendEmailWithAttachments({
      reference: data.reference,
      attachments: [
        { filename: bestandsnaam, path: localPath },
        { filename: originelePdfNaam, path: padOriginelePdf }
      ]
    });

    return res.status(200).json({ success: true, filename: bestandsnaam });
  } catch (error) {
    console.error('💥 Fout bij genereren .easy-bestand:', error);
    return res.status(500).json({ success: false, message: error.message || 'Onbekende fout' });
  }
}
