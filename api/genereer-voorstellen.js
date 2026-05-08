// api/genereer-voorstellen.js
//
// POST /api/genereer-voorstellen
//
// Analyseert historische_ritten + factuur_regels per klant en genereert
// prijsafspraak_voorstellen ter goedkeuring.
//
// Per (klant, laad_plaats, los_plaats, containertype) berekent dit:
//   - mediaan/min/max basis-tarief
//   - p10 en p90 (band waarbinnen 80% valt)
//   - frequentie en gemiddelde van elk toeslagtype
//
// Body:
//   { tenant: 'tiarotransport', minRitten?: 3, klant?: 'jordex' }
//
// Response:
//   { ok, gegenereerd, bijgewerkt, totaal, voorbeeld: [...] }

import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';
import { requirePermission } from '../utils/auth.js';

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function percentile(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
  return sorted[idx];
}
function round(n, dec = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = Math.pow(10, dec);
  return Math.round(n * f) / f;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const ctx = await requirePermission(req, res, 'edit_tarieven', slug, { json: true });
  if (!ctx) return;

  const { minRitten = 3, klant: klantFilter = null } = req.body || {};

  // Stap 1: lees historische_ritten (totaal_bedrag voor band-statistiek)
  let q = supabase.from('historische_ritten')
    .select('klant, laad_plaats, los_plaats, containertype, totaal_bedrag, datum')
    .eq('tenant_id', ctx.tenant.id);
  if (klantFilter) q = q.eq('klant', klantFilter.toLowerCase());
  const { data: ritten, error: rErr } = await q.limit(50000);
  if (rErr) return res.status(500).json({ error: 'historische_ritten lezen mislukt: ' + rErr.message });

  // Stap 2: lees factuur_regels voor toeslag-analyse (basis_tarief is exact, toeslagen apart)
  let qf = supabase.from('factuur_regels')
    .select('klant, route_ruw, containertype, basis_tarief, totaal_rit, datum, diesel_toeslag, delta_toeslag, rwg_toeslag, congestie_toeslag, adr_toeslag, wachtuur_toeslag, chassishuur, overige_toeslagen')
    .eq('tenant_id', ctx.tenant.id);
  if (klantFilter) qf = qf.ilike('klant', `%${klantFilter}%`);
  const { data: regels, error: fErr } = await qf.limit(50000);
  if (fErr) return res.status(500).json({ error: 'factuur_regels lezen mislukt: ' + fErr.message });

  // Stap 3: groeperen per (klant, laad_plaats, los_plaats, containertype)
  const groepen = new Map();
  function key(k, lp, sp, ct) {
    return [k || '', lp || '', sp || '', ct || ''].join('|');
  }

  for (const r of ritten || []) {
    if (!r.klant || !r.totaal_bedrag) continue;
    const k = key(r.klant, r.laad_plaats, r.los_plaats, r.containertype);
    if (!groepen.has(k)) groepen.set(k, {
      klant: r.klant, laad_plaats: r.laad_plaats, los_plaats: r.los_plaats, containertype: r.containertype,
      totaalBedragen: [], basisBedragen: [], data: [],
      toeslagen: { diesel: [], delta: [], rwg: [], congestie: [], adr: [], wachtuur: [], chassishuur: [], overige: {} },
      datums: [],
    });
    const g = groepen.get(k);
    g.totaalBedragen.push(r.totaal_bedrag);
    if (r.datum) g.datums.push(r.datum);
  }

  // factuur_regels: gebruik route_ruw als grove route-key (niet gesplitst in laad/los)
  // We groeperen factuur_regels op (klant, containertype) + route_ruw — een voorstel per routevariant
  for (const fr of regels || []) {
    if (!fr.klant || !fr.basis_tarief) continue;
    // Heuristiek: route_ruw als pseudo-route → splits op spaties tussen woorden
    // We lopen door alle bestaande groepen voor deze klant en checken of route_ruw matcht
    // (bv "ECT Delta MAASVLAKTE ECT Delta" → bevat MAASVLAKTE? → mogelijk een match)
    // Voor eenvoud: gebruik route_ruw als los_plaats, leeg laad_plaats — zo komen ze als eigen voorstel
    const klant = fr.klant.toLowerCase();
    const k = key(klant, '', fr.route_ruw, fr.containertype);
    if (!groepen.has(k)) groepen.set(k, {
      klant, laad_plaats: null, los_plaats: fr.route_ruw, containertype: fr.containertype,
      totaalBedragen: [], basisBedragen: [], data: [],
      toeslagen: { diesel: [], delta: [], rwg: [], congestie: [], adr: [], wachtuur: [], chassishuur: [], overige: {} },
      datums: [],
    });
    const g = groepen.get(k);
    g.basisBedragen.push(fr.basis_tarief);
    if (fr.totaal_rit) g.totaalBedragen.push(fr.totaal_rit);
    if (fr.datum) g.datums.push(fr.datum);
    if (fr.diesel_toeslag)    g.toeslagen.diesel.push(fr.diesel_toeslag);
    if (fr.delta_toeslag)     g.toeslagen.delta.push(fr.delta_toeslag);
    if (fr.rwg_toeslag)       g.toeslagen.rwg.push(fr.rwg_toeslag);
    if (fr.congestie_toeslag) g.toeslagen.congestie.push(fr.congestie_toeslag);
    if (fr.adr_toeslag)       g.toeslagen.adr.push(fr.adr_toeslag);
    if (fr.wachtuur_toeslag)  g.toeslagen.wachtuur.push(fr.wachtuur_toeslag);
    if (fr.chassishuur)       g.toeslagen.chassishuur.push(fr.chassishuur);
    if (fr.overige_toeslagen && typeof fr.overige_toeslagen === 'object') {
      for (const [naam, bedrag] of Object.entries(fr.overige_toeslagen)) {
        if (!g.toeslagen.overige[naam]) g.toeslagen.overige[naam] = [];
        g.toeslagen.overige[naam].push(Number(bedrag) || 0);
      }
    }
  }

  // Stap 4: bouw voorstel per groep met genoeg data
  const voorstellen = [];
  for (const g of groepen.values()) {
    const aantal = Math.max(g.totaalBedragen.length, g.basisBedragen.length);
    if (aantal < minRitten) continue;
    const bedragen = g.basisBedragen.length ? g.basisBedragen : g.totaalBedragen;

    const toeslagFreq = {};
    const totaalAantal = aantal;
    for (const [type, bedragenLijst] of Object.entries(g.toeslagen)) {
      if (type === 'overige') continue;
      if (!Array.isArray(bedragenLijst) || !bedragenLijst.length) continue;
      toeslagFreq[type] = {
        freq: round(bedragenLijst.length / totaalAantal, 3),
        avg: round(bedragenLijst.reduce((a, b) => a + b, 0) / bedragenLijst.length, 2),
        n: bedragenLijst.length,
      };
    }
    for (const [naam, lijst] of Object.entries(g.toeslagen.overige)) {
      if (!lijst.length) continue;
      toeslagFreq[`overig:${naam}`] = {
        freq: round(lijst.length / totaalAantal, 3),
        avg: round(lijst.reduce((a, b) => a + b, 0) / lijst.length, 2),
        n: lijst.length,
      };
    }

    const period_start = g.datums.length ? g.datums.reduce((a, b) => a < b ? a : b) : null;
    const period_end   = g.datums.length ? g.datums.reduce((a, b) => a > b ? a : b) : null;

    voorstellen.push({
      tenant_id: ctx.tenant.id,
      klant: g.klant,
      laad_plaats: g.laad_plaats,
      los_plaats: g.los_plaats,
      containertype: g.containertype,
      n_ritten: aantal,
      basis_tarief_mediaan: round(median(bedragen)),
      basis_tarief_min: round(Math.min(...bedragen)),
      basis_tarief_max: round(Math.max(...bedragen)),
      basis_tarief_p10: round(percentile(bedragen, 0.1)),
      basis_tarief_p90: round(percentile(bedragen, 0.9)),
      toeslagen_freq: toeslagFreq,
      period_start, period_end,
      onderbouwing: `${aantal} ritten, ${period_start ? period_start + ' t/m ' + period_end : 'periode onbekend'}`,
      status: 'concept',
    });
  }

  // Stap 5: upsert
  let nieuw = 0, bijgewerkt = 0;
  for (let i = 0; i < voorstellen.length; i += 100) {
    const batch = voorstellen.slice(i, i + 100);
    const { data, error } = await supabase
      .from('prijsafspraak_voorstellen')
      .upsert(batch, { onConflict: 'tenant_id,klant,laad_plaats,los_plaats,containertype' })
      .select('id, aangemaakt, bijgewerkt');
    if (error) return res.status(500).json({ error: 'Upsert fout: ' + error.message });
    for (const r of data || []) {
      // grove indicator: aangemaakt == bijgewerkt → nieuw
      if (r.aangemaakt && r.bijgewerkt && r.aangemaakt === r.bijgewerkt) nieuw++;
      else bijgewerkt++;
    }
  }

  return res.json({
    ok: true,
    totaal: voorstellen.length,
    gegenereerd: nieuw,
    bijgewerkt,
    voorbeeld: voorstellen.slice(0, 5),
  });
}
