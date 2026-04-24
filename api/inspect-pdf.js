// 📁 api/inspect-pdf.js — toont regelstructuur van een PDF uit Supabase inboxpdf bucket
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';

let _supabase;
function getSupabase() {
  return _supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  const bestand = req.query.file;
  if (!bestand) {
    return res.status(400).json({
      error: 'Geef een bestandsnaam mee via ?file=bestandsnaam.pdf',
      voorbeeld: '/api/inspect-pdf?file=transport_285404.pdf',
      supabaseUrl: process.env.SUPABASE_URL || '(niet ingesteld)',
      keySet: !!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY.includes('VERVANG')
    });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.includes('VERVANG')) {
      return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is niet ingesteld in de omgevingsvariabelen.' });
    }

    const { data, error } = await getSupabase()
      .storage
      .from('inboxpdf')
      .download(bestand);

    if (error) {
      return res.status(404).json({ error: `Download mislukt: ${error.message}` });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const { text } = await pdfParse(buffer);
    const regels = text.split('\n').map((r, i) => ({ index: i, tekst: r.trim() })).filter(r => r.tekst);

    return res.status(200).json({
      bestand,
      aantalRegels: regels.length,
      regels
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
