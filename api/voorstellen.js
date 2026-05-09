// api/voorstellen.js
//
// Endpoint voor prijsafspraak_voorstellen — lezen, goedkeuren, afkeuren, omzetten
// naar definitieve prijsafspraken.
//
// GET  /api/voorstellen?tenant=tiarotransport&status=concept&klant=jordex
//      → lijst voorstellen
// POST /api/voorstellen
//      body: { id, actie: 'goedkeuren' | 'afkeuren' | 'omzetten', aangenomen_basis?, notitie? }
//      → wijzig status
// PATCH /api/voorstellen
//      body: { id, aangenomen_basis?, aangenomen_all_in?, notitie? }
//      → bewerk voorstel

import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';
import { requirePermissionOrServiceToken } from '../utils/auth.js';

export default async function handler(req, res) {
  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const ctx = await requirePermissionOrServiceToken(req, res, 'edit_tarieven', slug, { json: true });
  if (!ctx) return;

  if (req.method === 'GET')   return lijst(req, res, ctx);
  if (req.method === 'POST')  return actie(req, res, ctx);
  if (req.method === 'PATCH') return bewerk(req, res, ctx);
  return res.status(405).json({ error: 'Method not allowed' });
}

async function lijst(req, res, ctx) {
  const { status = 'concept', klant, limit = 200 } = req.query || {};
  let q = supabase.from('prijsafspraak_voorstellen')
    .select('*')
    .eq('tenant_id', ctx.tenant.id);
  if (status && status !== 'alle') q = q.eq('status', status);
  if (klant) q = q.ilike('klant', `%${klant}%`);
  q = q.order('n_ritten', { ascending: false }).limit(Number(limit));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, voorstellen: data });
}

async function actie(req, res, ctx) {
  const { id, actie, aangenomen_basis, aangenomen_all_in, notitie } = req.body || {};
  if (!id || !actie) return res.status(400).json({ error: 'id en actie zijn verplicht' });

  const updates = { bijgewerkt: new Date().toISOString() };
  if (actie === 'goedkeuren') {
    updates.status = 'goedgekeurd';
    if (aangenomen_basis !== undefined) updates.aangenomen_basis = aangenomen_basis;
    if (aangenomen_all_in !== undefined) updates.aangenomen_all_in = aangenomen_all_in;
    if (notitie) updates.notitie = notitie;
  } else if (actie === 'afkeuren') {
    updates.status = 'afgekeurd';
    if (notitie) updates.notitie = notitie;
  } else if (actie === 'omzetten') {
    updates.status = 'omgezet';
  } else {
    return res.status(400).json({ error: 'onbekende actie: ' + actie });
  }

  const { data, error } = await supabase
    .from('prijsafspraak_voorstellen')
    .update(updates).eq('id', id).eq('tenant_id', ctx.tenant.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Bij 'omzetten': schrijf ook naar prijsafspraken
  if (actie === 'omzetten' && data) {
    const v = data;
    const tariefBedrag = v.aangenomen_basis ?? v.basis_tarief_mediaan;
    const velden = {
      laad_plaats: v.laad_plaats,
      los_plaats: v.los_plaats,
      containertype: v.containertype,
      basis_tarief: tariefBedrag,
      toeslagen: v.toeslagen_freq,
      bron: 'voorstel',
      voorstel_id: v.id,
      n_ritten_basis: v.n_ritten,
      onderbouwing: v.onderbouwing,
      notitie: v.notitie,
    };
    const { error: prErr } = await supabase.from('prijsafspraken').upsert({
      klant: v.klant,
      velden,
      all_in: v.aangenomen_all_in || false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'klant' });
    if (prErr) return res.status(500).json({ error: 'Omzetten naar prijsafspraken faalde: ' + prErr.message });
  }

  return res.json({ ok: true, voorstel: data });
}

async function bewerk(req, res, ctx) {
  const { id, aangenomen_basis, aangenomen_all_in, notitie } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id verplicht' });
  const updates = { bijgewerkt: new Date().toISOString() };
  if (aangenomen_basis !== undefined) updates.aangenomen_basis = aangenomen_basis;
  if (aangenomen_all_in !== undefined) updates.aangenomen_all_in = aangenomen_all_in;
  if (notitie !== undefined) updates.notitie = notitie;
  const { data, error } = await supabase
    .from('prijsafspraak_voorstellen')
    .update(updates).eq('id', id).eq('tenant_id', ctx.tenant.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, voorstel: data });
}
