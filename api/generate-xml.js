// 📁 /api/generate-xml.js

import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    console.warn('⚠️ Fout: Methode niet toegestaan:', req.method);
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    console.log('📥 Ontvangen JSON body voor XML-generatie:', req.body);
    const json = req.body;

    const xml = await generateXmlFromJson(json);
    if (!xml || typeof xml !== 'string') {
      console.error('❌ XML-output is ongeldig of leeg:', xml);
      throw new Error('❌ Ongeldig XML-resultaat gegenereerd');
    }

    console.log('✅ XML succesvol gegenereerd');
    return res.status(200).json({ success: true, xml });

  } catch (err) {
    console.error('❌ Fout bij XML-generatie:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}