// api/prijsafspraken.js
// GET  → alle prijsafspraken voor een tenant ophalen
// POST → één klant upserten
import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';
import { requirePermission } from '../utils/auth.js';

export default async function handler(req, res) {
  // Tenant-slug komt uit ?tenant=... (gestuurd door dashboard JS).
  // Default = 'tiarotransport' voor backwards-compatibiliteit.
  const slug = (req.query?.tenant || 'tiarotransport').toString();
  const needPerm = req.method === 'GET' ? 'view_tarieven' : 'edit_tarieven';

  const ctx = await requirePermission(req, res, needPerm, slug, { json: true });
  if (!ctx) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('prijsafspraken')
      .select('*')
      .order('klant');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

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
