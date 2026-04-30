// api/prijsafspraken.js
// GET  → alle prijsafspraken ophalen
// POST → één klant upserten
import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';

export default async function handler(req, res) {
  const token = req.query?.token || req.headers?.['x-token'] || '';
  if (token !== (process.env.CRON_SECRET || '')) {
    return res.status(401).json({ error: 'Niet geautoriseerd' });
  }

  // ── GET: alle records ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('prijsafspraken')
      .select('*')
      .order('klant');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  // ── POST: upsert één klant ───────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    // Altijd lowercase opslaan zodat enrichOrder (die ook lowercase zoekt) altijd matcht
    const klant  = (body.klant || '').toLowerCase().trim();
    const velden = body.velden;
    const all_in = body.all_in;
    if (!klant) return res.status(400).json({ error: 'klant is verplicht' });

    const { error } = await supabase
      .from('prijsafspraken')
      .upsert({ klant, velden, all_in: !!all_in, updated_at: new Date().toISOString() }, { onConflict: 'klant' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
