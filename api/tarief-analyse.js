// api/tarief-analyse.js
// POST → analyseer historische ritten van een klant en bouw een voorstel
//        voor prijsafspraken.velden ({_tarieven, toeslagen}).
//
// Body (JSON):
//   {
//     tenant: 'tiarotransport',
//     klant: 'jordex',
//     min_ritten: 2,        // min aantal ritten per locatie om mee te tellen
//     schrijf: false        // true → schrijf direct in prijsafspraken
//   }
//
// Antwoord (dry-run):
//   {
//     klant: 'jordex',
//     totaal_ritten: 1234,
//     voorstel: {
//       _tarieven: [{ naam, plaats, tarief, aantal, min, max }, ...],
//       diesel:    { chart, label, actief, frequentie },
//       adr:       { chart, label, actief, frequentie },
//       wachtuur:  { chart, label, actief, frequentie },
//     }
//   }

import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';
import { requirePermission } from '../utils/auth.js';

// Statistiek-helpers
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function gemiddeld(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function rond(n, dec = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n * Math.pow(10, dec)) / Math.pow(10, dec);
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const needPerm = req.method === 'GET' ? 'view_tarieven' : 'edit_tarieven';
  const ctx = await requirePermission(req, res, needPerm, slug, { json: true });
  if (!ctx) return;

  const klant = (req.query?.klant || req.body?.klant || '').toLowerCase().trim();
  if (!klant) return res.status(400).json({ error: 'klant is verplicht' });

  const minRitten = Number(req.body?.min_ritten ?? req.query?.min_ritten ?? 2);
  const schrijf = req.body?.schrijf === true;

  // Haal alle historische ritten op voor deze klant + tenant
  // Paginatie omdat Supabase default 1000 limiet heeft
  let alle = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('historische_ritten')
      .select('los_naam, los_plaats, basis_tarief, totaal_bedrag, is_adr, adr_toeslag, diesel_toeslag, wachtuur_aantal, wachtuur_tarief')
      .eq('klant', klant)
      .eq('tenant_id', ctx.tenant.id)
      .range(from, from + PAGE - 1);

    if (error) return res.status(500).json({ error: error.message });
    if (!data || data.length === 0) break;

    alle = alle.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  if (alle.length === 0) {
    return res.status(404).json({ error: `Geen historische ritten gevonden voor klant '${klant}'` });
  }

  // ─── Aggregeer per (los_naam, los_plaats) ─────────────────────────────
  const groepen = new Map(); // key = "naam||plaats" → array van basis_tarief
  for (const rit of alle) {
    if (!rit.los_naam || rit.basis_tarief == null) continue;
    const key = `${rit.los_naam.trim()}||${(rit.los_plaats || '').trim()}`;
    if (!groepen.has(key)) groepen.set(key, { naam: rit.los_naam.trim(), plaats: (rit.los_plaats || '').trim(), tarieven: [] });
    groepen.get(key).tarieven.push(Number(rit.basis_tarief));
  }

  const tarievenLijst = [];
  for (const { naam, plaats, tarieven } of groepen.values()) {
    if (tarieven.length < minRitten) continue;
    const med = median(tarieven);
    tarievenLijst.push({
      naam,
      plaats,
      tarief: rond(med),
      aantal: tarieven.length,
      min: rond(Math.min(...tarieven)),
      max: rond(Math.max(...tarieven)),
      gem: rond(gemiddeld(tarieven)),
    });
  }
  tarievenLijst.sort((a, b) => b.aantal - a.aantal);

  // ─── Toeslagen-analyse ────────────────────────────────────────────────
  const totaal = alle.length;

  const adrRitten = alle.filter(r => r.is_adr);
  const adrToeslagen = adrRitten.map(r => Number(r.adr_toeslag)).filter(v => v > 0);
  const dieselToeslagen = alle.map(r => Number(r.diesel_toeslag)).filter(v => v > 0);
  const wachturen = alle.filter(r => r.wachtuur_aantal && r.wachtuur_tarief);
  const wachtuurTarieven = wachturen.map(r => Number(r.wachtuur_tarief)).filter(v => v > 0);

  const toeslagen = {
    adr: {
      chart: rond(median(adrToeslagen)) ?? 0,
      label: 'ADR toeslag',
      actief: adrToeslagen.length >= minRitten,
      frequentie: rond(adrRitten.length / totaal, 3),
      voorbeelden: adrToeslagen.length,
    },
    diesel: {
      chart: rond(median(dieselToeslagen)) ?? 0,
      label: 'Diesel toeslag',
      actief: dieselToeslagen.length >= minRitten,
      frequentie: rond(dieselToeslagen.length / totaal, 3),
      voorbeelden: dieselToeslagen.length,
    },
    wachtuur: {
      chart: rond(median(wachtuurTarieven)) ?? 0,
      label: 'Wachtuur tarief',
      actief: wachtuurTarieven.length >= minRitten,
      frequentie: rond(wachturen.length / totaal, 3),
      voorbeelden: wachtuurTarieven.length,
    },
  };

  const voorstel = {
    _tarieven: tarievenLijst,
    ...toeslagen,
  };

  // ─── Optioneel direct schrijven naar prijsafspraken ───────────────────
  let geschreven = false;
  if (schrijf) {
    // Behoud bestaande velden die niet door deze analyse worden geraakt
    const { data: bestaand } = await supabase
      .from('prijsafspraken')
      .select('velden, all_in')
      .eq('klant', klant)
      .maybeSingle();

    const samengevoegd = {
      ...(bestaand?.velden || {}),
      _tarieven: tarievenLijst,
      adr: { chart: toeslagen.adr.chart, label: toeslagen.adr.label, actief: toeslagen.adr.actief },
      diesel: { chart: toeslagen.diesel.chart, label: toeslagen.diesel.label, actief: toeslagen.diesel.actief },
      wachtuur: { chart: toeslagen.wachtuur.chart, label: toeslagen.wachtuur.label, actief: toeslagen.wachtuur.actief },
    };

    const { error: upsertError } = await supabase
      .from('prijsafspraken')
      .upsert(
        { klant, velden: samengevoegd, all_in: bestaand?.all_in ?? false, updated_at: new Date().toISOString() },
        { onConflict: 'klant' }
      );
    if (upsertError) return res.status(500).json({ error: upsertError.message });
    geschreven = true;

    // Markeer de meest recente import van deze klant als geanalyseerd
    await supabase
      .from('tarief_imports')
      .update({ status: 'geanalyseerd' })
      .eq('klant', klant)
      .eq('tenant_id', ctx.tenant.id);
  }

  return res.status(200).json({
    klant,
    totaal_ritten: totaal,
    aantal_unieke_loslocaties: tarievenLijst.length,
    voorstel,
    geschreven,
    schrijf_was_gevraagd: schrijf,
  });
}
