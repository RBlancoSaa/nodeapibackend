// 📁 api/send-final-email.js

import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { convertXmlToEasyfile } from '../services/convertXmlToEasyfile.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { json, reference, laadplaats } = req.body;

    if (!json || !reference || !laadplaats) {
      return res.status(400).json({
        success: false,
        message: 'Vereiste gegevens ontbreken (json, reference, laadplaats)'
      });
    }

    const xml = generateXmlFromJson(json);
    const { filename, filePath } = convertXmlToEasyfile(xml, reference, laadplaats);
    await sendEmailWithAttachments({ reference, filePath, filename });

    return res.status(200).json({ success: true, message: `${filename} verstuurd per e-mail` });
  } catch (err) {
    console.error('💥 Fout bij verzenden e-mail:', err.message || err);
    return res.status(500).json({ success: false, message: err.message || 'Serverfout' });
  }
}