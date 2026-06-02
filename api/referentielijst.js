// api/referentielijst.js
//
// GET  /api/referentielijst?naam=op_afzetten   → leest <naam>.json uit
//                                                 Supabase Storage bucket
//                                                 `referentielijsten`
// POST /api/referentielijst?naam=op_afzetten   → schrijft de meegestuurde
//   body: { items: [...] }                       lijst terug (overwrite)
// GET  /api/referentielijst/lijsten             → metadata van alle JSON's
//                                                 in de bucket
//
// Beschermd met service-token of user-sessie (edit_tarieven).
// Doel: één bron van waarheid (Supabase Storage), beheerbaar via Romy-HQ UI.

import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';
import { requirePermissionOrServiceToken } from '../utils/auth.js';

const BUCKET = 'referentielijsten';

// Alleen deze namen mogen gelezen/geschreven worden (whitelist tegen tikken)
const TOEGESTANE_LIJSTEN = new Set([
  'op_afzetten', 'rederijen', 'klanten', 'containers',
  'steinweg_adressen', 'charters', 'adresboek', 'terminals',
]);

function pad(naam) {
  return `${naam}.json`;
}

export default async function handler(req, res) {
  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const ctx = await requirePermissionOrServiceToken(req, res, 'edit_tarieven', slug, { json: true });
  if (!ctx) return;

  // Lijsten-overzicht
  if (req.method === 'GET' && req.query?.lijsten === '1') {
    return await lijstOverzicht(res);
  }

  const naam = String(req.query?.naam || '').toLowerCase().trim();
  if (!naam) return res.status(400).json({ error: 'naam (lijstnaam) is verplicht' });
  if (!TOEGESTANE_LIJSTEN.has(naam)) {
    return res.status(400).json({ error: `lijst "${naam}" niet toegestaan. Toegestaan: ${[...TOEGESTANE_LIJSTEN].join(', ')}` });
  }

  try {
    if (req.method === 'GET')  return await lees(naam, res);
    if (req.method === 'PUT' || req.method === 'POST') return await schrijf(naam, req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'Onverwacht: ' + e.message });
  }
}

async function lees(naam, res) {
  const { data, error } = await supabase.storage.from(BUCKET).download(pad(naam));
  if (error) {
    if (error.message?.includes('not found') || error.statusCode === '404') {
      return res.json({ ok: true, naam, items: [], aantal: 0, melding: 'Bestand bestaat nog niet — leeg startpunt' });
    }
    return res.status(500).json({ error: 'Download mislukte: ' + error.message });
  }
  const tekst = Buffer.from(await data.arrayBuffer()).toString('utf-8');
  let items;
  try { items = JSON.parse(tekst); }
  catch (e) { return res.status(500).json({ error: 'Bestand is geen geldige JSON: ' + e.message }); }
  if (!Array.isArray(items)) {
    return res.status(500).json({ error: `Verwacht een JSON-array, kreeg ${typeof items}` });
  }
  const velden = [...new Set(items.slice(0, 50).flatMap(o => Object.keys(o || {})))];
  return res.json({ ok: true, naam, items, aantal: items.length, velden });
}

async function schrijf(naam, req, res) {
  const { items } = req.body || {};
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'body.items moet een array zijn' });
  }
  // Lichte validatie: elk item is een object
  if (items.some(it => it === null || typeof it !== 'object' || Array.isArray(it))) {
    return res.status(400).json({ error: 'elk item moet een object zijn (geen array/null)' });
  }
  const json = JSON.stringify(items, null, 2);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(pad(naam), Buffer.from(json), {
      contentType: 'application/json',
      upsert: true,
    });
  if (error) return res.status(500).json({ error: 'Upload mislukte: ' + error.message });

  return res.json({ ok: true, naam, aantal: items.length, melding: `Opgeslagen: ${items.length} entries in ${pad(naam)}` });
}

async function lijstOverzicht(res) {
  const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 100 });
  if (error) return res.status(500).json({ error: error.message });
  const lijsten = (data || [])
    .filter(o => o.name.endsWith('.json'))
    .map(o => ({
      naam: o.name.replace(/\.json$/, ''),
      bestand: o.name,
      size: o.metadata?.size || 0,
      updated_at: o.updated_at,
      beheerd: TOEGESTANE_LIJSTEN.has(o.name.replace(/\.json$/, '')),
    }))
    .sort((a, b) => a.naam.localeCompare(b.naam));
  return res.json({ ok: true, lijsten });
}
