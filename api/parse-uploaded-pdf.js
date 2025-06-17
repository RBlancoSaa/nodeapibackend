// ✅ Stap 1: /api/parse-uploaded-pdf.js
// Doel: haal JSON uit PDF (via Supabase-bestand)
import parsePdfToJson from '../services/parsePdfToJson.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ success: false, message: 'Geen bestandsnaam opgegeven' });

  const { data, error } = await supabase.storage.from('inboxpdf').download(filename);
  if (error) return res.status(500).json({ success: false, message: 'Fout bij downloaden PDF' });

  const json = await parsePdfToJson(data);
  res.status(200).json({ success: true, json });
}
