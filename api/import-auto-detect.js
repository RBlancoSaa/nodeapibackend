// api/import-auto-detect.js
//
// POST /api/import/auto-detect
//
// Detecteert het type bestand en routeert naar de juiste importer.
// Body (JSON):
//   {
//     tenant: 'tiarotransport',
//     bestandsnaam: 'oudedata.xlsx',
//     data_base64: '...',
//     dryRun: false   // true = alleen detectie + preview, niet schrijven
//   }
//
// Response:
//   {
//     ok, type, vertrouwen, samenvatting, importId?, details
//   }
//
// Ondersteunde types (zie parsers/detectFileType.js):
//   - rpt_facturen_xps       → factuur_imports + factuur_header + factuur_regels
//   - tiaro_rittenarchief    → tarief_imports + historische_ritten
//   - easytrip_stamdata      → upload als JSON naar Supabase Storage (referentielijsten)
//   - adresboek              → upload als JSON naar Supabase Storage
//   - losse_factuur_pdf      → (placeholder — nog niet geïmplementeerd)

import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';
import { requirePermission } from '../utils/auth.js';
import { detectFileType } from '../parsers/detectFileType.js';
import { parseRptFacturenXps, toeslagNaarKolom, normaliseerToeslag } from '../parsers/parseRptFacturenXps.js';
import { parseTiaroRittenarchief } from '../parsers/parseTiaroRittenarchief.js';
import { parseAdresboek } from '../parsers/parseAdresboek.js';
import { parseEasytripStamdata } from '../parsers/parseEasytripStamdata.js';
import { parsePdfFactuur } from '../parsers/parsePdfFactuur.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const ctx = await requirePermission(req, res, 'edit_tarieven', slug, { json: true });
  if (!ctx) return;

  const { bestandsnaam, data_base64, dryRun } = req.body || {};
  if (!bestandsnaam) return res.status(400).json({ error: 'bestandsnaam is verplicht' });
  if (!data_base64)  return res.status(400).json({ error: 'data_base64 ontbreekt' });

  let buffer;
  try { buffer = Buffer.from(data_base64, 'base64'); }
  catch (e) { return res.status(400).json({ error: 'data_base64 is geen geldige base64' }); }
  if (!buffer.length) return res.status(400).json({ error: 'leeg bestand' });

  const detect = detectFileType(buffer, bestandsnaam);

  // Dispatch op type
  try {
    switch (detect.type) {
      case 'rpt_facturen_xps':
        return await verwerkXps(req, res, ctx, buffer, bestandsnaam, detect, !!dryRun);
      case 'tiaro_rittenarchief':
        return await verwerkRittenarchief(req, res, ctx, buffer, bestandsnaam, detect, !!dryRun);
      case 'adresboek':
        return await verwerkAdresboek(req, res, ctx, buffer, bestandsnaam, detect, !!dryRun);
      case 'easytrip_stamdata':
        return await verwerkStamdata(req, res, ctx, buffer, bestandsnaam, detect, !!dryRun);
      case 'losse_factuur_pdf':
        return await verwerkPdfFactuur(req, res, ctx, buffer, bestandsnaam, detect, !!dryRun);
      default:
        return res.status(400).json({
          ok: false, type: detect.type, vertrouwen: detect.vertrouwen,
          melding: 'Bestand niet herkend.', details: detect.details,
        });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Verwerking mislukte: ' + e.message });
  }
}

// ─── XPS factuurarchief ────────────────────────────────────────────────
async function verwerkXps(req, res, ctx, buffer, bestandsnaam, detect, dryRun) {
  const parsed = parseRptFacturenXps(buffer);

  const samenvatting = {
    aantalFacturen: parsed.totaalFacturen,
    aantalRegels: parsed.totaalRegels,
    aantalToeslagen: parsed.totaalToeslagen,
    topToeslagtypes: parsed.topToeslagtypes.slice(0, 15),
    klantenInArchief: [...new Set(parsed.facturen.map(f => f.klant).filter(Boolean))].slice(0, 30),
  };

  if (dryRun) return res.json({ ok: true, type: detect.type, vertrouwen: detect.vertrouwen, samenvatting });

  // import-record
  const { data: importRow, error: impErr } = await supabase
    .from('factuur_imports')
    .insert({
      tenant_id: ctx.tenant.id,
      bestandsnaam,
      bron: 'rpt_facturen_xps',
      aantal_facturen: parsed.totaalFacturen,
      aantal_regels: parsed.totaalRegels,
      aantal_toeslagen: parsed.totaalToeslagen,
      status: 'verwerkt',
      meta: { topToeslagtypes: parsed.topToeslagtypes.slice(0, 30) },
    }).select().single();
  if (impErr) return res.status(500).json({ ok: false, error: 'Import-record fout: ' + impErr.message });

  // Factuur-headers en -regels per batch
  let nFacturen = 0, nRegels = 0;
  for (let i = 0; i < parsed.facturen.length; i += 50) {
    const batch = parsed.facturen.slice(i, i + 50);
    const headerRows = batch.map(f => ({
      import_id: importRow.id,
      tenant_id: ctx.tenant.id,
      factuurnummer: f.factuurnummer,
      klant: f.klant,
      factuurdatum: f.factuurdatum,
      btw_nummer_klant: f.btwNummerKlant,
      dossiernummer: f.dossiernummer,
      totaal_bedrag: f.totaal,
      paginanummer: f.paginanummer,
      raw: { regelCount: f.regels.length },
    }));
    const { data: headersIns, error: hErr } = await supabase
      .from('factuur_header')
      .upsert(headerRows, { onConflict: 'tenant_id,factuurnummer' })
      .select('id, factuurnummer');
    if (hErr) return res.status(500).json({ ok: false, error: 'Factuur-header fout: ' + hErr.message });
    nFacturen += headersIns.length;

    // Map factuurnr → id
    const idByFactuur = new Map(headersIns.map(h => [h.factuurnummer, h.id]));
    const regelRows = [];
    for (const f of batch) {
      const fid = idByFactuur.get(f.factuurnummer);
      if (!fid) continue;
      for (const r of f.regels) {
        const row = {
          factuur_id: fid,
          tenant_id: ctx.tenant.id,
          klant: f.klant,
          datum: r.datum,
          ons_ritnr: r.onsRitnr,
          uw_ritnr: r.uwRitnr,
          container: r.container,
          containertype: r.containertype,
          route_ruw: r.routeRuw,
          btw_perc: r.btwPerc,
          basis_tarief: r.basisTarief,
          totaal_rit: r.totaalRit,
          overige_toeslagen: {},
        };
        for (const t of r.toeslagen) {
          const norm = normaliseerToeslag(t.omschrijving);
          const kolom = toeslagNaarKolom(norm);
          if (kolom) {
            row[kolom] = (row[kolom] || 0) + (t.bedrag || 0);
          } else {
            row.overige_toeslagen[norm] = (row.overige_toeslagen[norm] || 0) + (t.bedrag || 0);
          }
        }
        regelRows.push(row);
      }
    }
    if (regelRows.length) {
      const { error: rErr, count } = await supabase
        .from('factuur_regels').insert(regelRows, { count: 'exact' });
      if (rErr) return res.status(500).json({ ok: false, error: 'Factuur-regel fout: ' + rErr.message });
      nRegels += count ?? regelRows.length;
    }
  }

  return res.json({
    ok: true, type: detect.type, vertrouwen: detect.vertrouwen,
    importId: importRow.id, samenvatting,
    geschreven: { facturen: nFacturen, regels: nRegels },
  });
}

// ─── Tiaro rittenarchief (oudedata.xlsx) ───────────────────────────────
async function verwerkRittenarchief(req, res, ctx, buffer, bestandsnaam, detect, dryRun) {
  const parsed = parseTiaroRittenarchief(buffer);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  const samenvatting = {
    aantalRijen: parsed.totaalRijen,
    aantalKlanten: parsed.aantalKlanten,
    topKlanten: parsed.klantStats.slice(0, 15),
  };
  if (dryRun) return res.json({ ok: true, type: detect.type, vertrouwen: detect.vertrouwen, samenvatting });

  // Per klant een aparte tarief_imports record (zodat je kan filteren),
  // óf één gezamenlijk record voor de hele archief-import. We kiezen het laatste —
  // klant per rij, één import-batch.
  const { data: importRow, error: impErr } = await supabase
    .from('tarief_imports')
    .insert({
      tenant_id: ctx.tenant.id,
      klant: 'archief_alle',
      bron: 'tiaro_rittenarchief',
      bestandsnaam,
      aantal_rijen: parsed.totaalRijen,
      aantal_geslaagd: 0,
      aantal_skipped: 0,
      status: 'verwerkt',
      meta: { aantalKlanten: parsed.aantalKlanten, topKlanten: parsed.klantStats.slice(0, 30) },
    }).select().single();
  if (impErr) return res.status(500).json({ ok: false, error: 'Import-record fout: ' + impErr.message });

  let geslaagd = 0, foutMelding = null;
  for (let i = 0; i < parsed.rijen.length; i += 500) {
    const batch = parsed.rijen.slice(i, i + 500).map(r => {
      const { _klant, ...rest } = r;
      return {
        import_id: importRow.id,
        tenant_id: ctx.tenant.id,
        klant: _klant,
        ...rest,
      };
    });
    const { error, count } = await supabase
      .from('historische_ritten').insert(batch, { count: 'exact' });
    if (error) { foutMelding = error.message; break; }
    geslaagd += count ?? batch.length;
  }

  await supabase.from('tarief_imports').update({
    aantal_geslaagd: geslaagd,
    aantal_skipped: parsed.rijen.length - geslaagd,
    status: foutMelding ? 'fout' : 'verwerkt',
    fout_melding: foutMelding,
  }).eq('id', importRow.id);

  return res.json({
    ok: !foutMelding, type: detect.type, vertrouwen: detect.vertrouwen,
    importId: importRow.id, samenvatting,
    geschreven: { rijen: geslaagd, fout: foutMelding },
  });
}

// ─── Adresboek / klantenlijst ──────────────────────────────────────────
async function verwerkAdresboek(req, res, ctx, buffer, bestandsnaam, detect, dryRun) {
  const parsed = parseAdresboek(buffer);
  if (parsed.error) return res.status(400).json({ ok: false, error: parsed.error });

  const samenvatting = {
    aantalEntries: parsed.totaalEntries,
    typeStats: parsed.typeStats,
    voorbeeld: parsed.entries.slice(0, 5),
  };
  if (dryRun) return res.json({ ok: true, type: detect.type, vertrouwen: detect.vertrouwen, samenvatting });

  // Schrijf naar Supabase Storage als JSON in referentielijsten/adresboek_<datum>.json
  const datum = new Date().toISOString().slice(0, 10);
  const path = `adresboek_${datum}_${Date.now()}.json`;
  const json = JSON.stringify({ bron: bestandsnaam, totaal: parsed.totaalEntries, entries: parsed.entries }, null, 2);

  const { error: upErr } = await supabase.storage
    .from('referentielijsten')
    .upload(path, Buffer.from(json), { contentType: 'application/json', upsert: true });
  if (upErr) return res.status(500).json({ ok: false, error: 'Storage upload fout: ' + upErr.message });

  return res.json({
    ok: true, type: detect.type, vertrouwen: detect.vertrouwen,
    storagePath: path, samenvatting,
  });
}

// ─── Losse factuur-PDF ──────────────────────────────────────────────────
async function verwerkPdfFactuur(req, res, ctx, buffer, bestandsnaam, detect, dryRun) {
  const { factuur } = await parsePdfFactuur(buffer);
  if (!factuur.factuurnummer) {
    return res.status(400).json({
      ok: false, type: detect.type, vertrouwen: detect.vertrouwen,
      error: 'Factuurnummer niet gevonden — is dit een Tiaro-factuur?',
    });
  }

  // Kijk per regel of er een actieve prijsafspraak is en flag afwijkingen
  const alerts = [];
  if (factuur.klant) {
    const { data: afspraak } = await supabase
      .from('prijsafspraken')
      .select('velden, all_in')
      .ilike('klant', factuur.klant.toLowerCase())
      .maybeSingle();
    if (afspraak?.velden?.basis_tarief) {
      const verwacht = Number(afspraak.velden.basis_tarief);
      for (const r of factuur.regels) {
        if (r.basisTarief && Math.abs(r.basisTarief - verwacht) > Math.max(5, verwacht * 0.05)) {
          alerts.push({
            ritnr: r.onsRitnr, container: r.container, route: r.routeRuw,
            verwacht, gefactureerd: r.basisTarief, verschil: r.basisTarief - verwacht,
          });
        }
      }
    }
  }

  const samenvatting = {
    factuurnummer: factuur.factuurnummer,
    klant: factuur.klant,
    factuurdatum: factuur.factuurdatum,
    aantalRegels: factuur.regels.length,
    aantalToeslagen: factuur.regels.reduce((n, r) => n + r.toeslagen.length, 0),
    totaal: factuur.totaal,
    alerts,
  };

  if (dryRun) return res.json({ ok: true, type: detect.type, vertrouwen: detect.vertrouwen, samenvatting });

  // Schrijf factuur (gebruik factuur_imports met bron='losse_pdf')
  const { data: importRow, error: impErr } = await supabase
    .from('factuur_imports')
    .insert({
      tenant_id: ctx.tenant.id, bestandsnaam, bron: 'losse_pdf',
      aantal_facturen: 1, aantal_regels: factuur.regels.length,
      aantal_toeslagen: samenvatting.aantalToeslagen, status: 'verwerkt',
      meta: { alerts },
    }).select().single();
  if (impErr) return res.status(500).json({ ok: false, error: 'Import-record fout: ' + impErr.message });

  const { data: hdr, error: hErr } = await supabase
    .from('factuur_header')
    .upsert({
      import_id: importRow.id, tenant_id: ctx.tenant.id,
      factuurnummer: factuur.factuurnummer, klant: factuur.klant,
      factuurdatum: factuur.factuurdatum, btw_nummer_klant: factuur.btwNummerKlant,
      dossiernummer: factuur.dossiernummer, totaal_bedrag: factuur.totaal,
    }, { onConflict: 'tenant_id,factuurnummer' })
    .select('id').single();
  if (hErr) return res.status(500).json({ ok: false, error: 'Factuur-header fout: ' + hErr.message });

  const regelRows = factuur.regels.map(r => {
    const row = {
      factuur_id: hdr.id, tenant_id: ctx.tenant.id, klant: factuur.klant,
      datum: r.datum, ons_ritnr: r.onsRitnr, uw_ritnr: r.uwRitnr,
      container: r.container, containertype: r.containertype,
      route_ruw: r.routeRuw, btw_perc: r.btwPerc,
      basis_tarief: r.basisTarief, totaal_rit: r.totaalRit,
      overige_toeslagen: {},
    };
    for (const t of r.toeslagen) {
      const norm = normaliseerToeslag(t.omschrijving);
      const kolom = toeslagNaarKolom(norm);
      if (kolom) row[kolom] = (row[kolom] || 0) + (t.bedrag || 0);
      else       row.overige_toeslagen[norm] = (row.overige_toeslagen[norm] || 0) + (t.bedrag || 0);
    }
    return row;
  });
  if (regelRows.length) {
    const { error: rErr } = await supabase.from('factuur_regels').insert(regelRows);
    if (rErr) return res.status(500).json({ ok: false, error: 'Factuur-regels fout: ' + rErr.message });
  }

  return res.json({
    ok: true, type: detect.type, vertrouwen: detect.vertrouwen,
    importId: importRow.id, samenvatting,
    alerts: alerts.length ? `⚠️ ${alerts.length} afwijking(en) ten opzichte van prijsafspraak` : null,
  });
}

// ─── Easytrip stamdata (multi-sheet referentie) ─────────────────────────
async function verwerkStamdata(req, res, ctx, buffer, bestandsnaam, detect, dryRun) {
  const parsed = parseEasytripStamdata(buffer);
  const samenvatting = { sheets: parsed.sheetNames, counts: parsed.counts };
  if (dryRun) return res.json({ ok: true, type: detect.type, vertrouwen: detect.vertrouwen, samenvatting });

  // Schrijf elk type naar een eigen JSON-bestand in Storage
  const datum = new Date().toISOString().slice(0, 10);
  const uploads = [];
  for (const [key, items] of Object.entries(parsed.data)) {
    if (!Array.isArray(items) || !items.length) continue;
    const path = `stamdata/${key}_${datum}.json`;
    const json = JSON.stringify({ bron: bestandsnaam, totaal: items.length, items }, null, 2);
    const { error } = await supabase.storage
      .from('referentielijsten')
      .upload(path, Buffer.from(json), { contentType: 'application/json', upsert: true });
    if (error) uploads.push({ key, path, error: error.message });
    else uploads.push({ key, path, count: items.length });
  }

  return res.json({
    ok: true, type: detect.type, vertrouwen: detect.vertrouwen,
    samenvatting, uploads,
  });
}
