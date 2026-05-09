// 📁 api/inspect-pdf.js — toont regelstructuur van een PDF uit Supabase inboxpdf bucket
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';
import { acceptCronToken, getCurrentUser } from '../utils/auth.js';
import { validateFilename } from '../utils/validateFilename.js';

let _supabase;
function getSupabase() {
  return _supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export default async function handler(req, res) {
  // Auth: of een ingelogde gebruiker, of een geldige cron-token. Anders 401.
  const user = await getCurrentUser(req);
  if (!user) {
    if (!acceptCronToken(req, res, { json: true })) return;
  }

  let bestand;
  try {
    bestand = validateFilename(req.query.file || '');
  } catch (e) {
    return res.status(400).json({
      error: 'Geef een geldige bestandsnaam mee via ?file=bestandsnaam.pdf'
    });
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY.includes('VERVANG')) {
      return res.status(500).json({ error: 'Server niet correct geconfigureerd' });
    }

    const { data, error } = await getSupabase()
      .storage
      .from('inboxpdf')
      .download(bestand);

    if (error) {
      return res.status(404).json({ error: 'Bestand niet gevonden' });
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
    console.error('inspect-pdf error:', err);
    return res.status(500).json({ error: 'Interne fout bij verwerken PDF' });
  }
}
