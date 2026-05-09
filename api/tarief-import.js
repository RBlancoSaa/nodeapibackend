// api/tarief-import.js
// POST → Easytrip Excel uploaden, parsen, opslaan in historische_ritten
//
// Body (JSON):
//   {
//     tenant: 'tiarotransport',
//     klant: 'jordex',
//     bestandsnaam: 'easytrip_jordex.xlsx',
//     data_base64: '...'      // .xlsx als base64-string
//   }
//
// Antwoord:
//   {
//     ok: true,
//     import_id: '...',
//     totaal_rijen: 1234,
//     niet_herkende_kolommen: [...],   // helpt om COLUMN_SYNONYMS uit te breiden
//     overige_toeslagen_kolommen: [...]
//   }

import '../utils/fsPatch.js';
import { supabase } from '../services/supabaseClient.js';
import { requirePermission } from '../utils/auth.js';
import { parseEasytripXlsx } from '../parsers/parseEasytrip.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const slug = (req.query?.tenant || req.body?.tenant || 'tiarotransport').toString();
  const ctx = await requirePermission(req, res, 'edit_tarieven', slug, { json: true });
  if (!ctx) return;

  const { klant, bestandsnaam, data_base64, sheetName } = req.body || {};
  if (!klant) return res.status(400).json({ error: 'klant is verplicht' });
  if (!data_base64) return res.status(400).json({ error: 'data_base64 ontbreekt' });

  let buffer;
  try {
    buffer = Buffer.from(data_base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'data_base64 is geen geldige base64' });
  }
  if (!buffer.length) return res.status(400).json({ error: 'leeg bestand' });

  const klantLower = klant.toLowerCase().trim();

  let parsed;
  try {
    parsed = parseEasytripXlsx(buffer, { sheetName, klant: klantLower });
  } catch (e) {
    return res.status(400).json({ error: 'Parse-fout: ' + e.message });
  }

  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }

  // 1. Maak import-record
  const { data: importRow, error: importError } = await supabase
    .from('tarief_imports')
    .insert({
      tenant_id: ctx.tenant.id,
      klant: klantLower,
      bron: 'easytrip',
      bestandsnaam: bestandsnaam || null,
      aantal_rijen: parsed.totaalRijen,
      aantal_geslaagd: 0,
      aantal_skipped: 0,
      status: 'verwerkt',
      meta: {
        herkende_velden: Object.keys(parsed.headerMap),
        niet_herkende_kolommen: parsed.niet_herkend,
        overige_toeslagen_kolommen: parsed.overigeKolommen,
      },
    })
    .select()
    .single();

  if (importError) {
    return res.status(500).json({ error: 'Import-record aanmaken mislukt: ' + importError.message });
  }

  // 2. Bulk insert van rijen
  const ritten = parsed.rijen.map(r => ({
    import_id: importRow.id,
    tenant_id: ctx.tenant.id,
    klant: klantLower,
    ritnummer: r.ritnummer,
    datum: r.datum,
    laad_naam: r.laad_naam,
    laad_plaats: r.laad_plaats,
    laad_postcode: r.laad_postcode,
    laad_land: r.laad_land,
    los_naam: r.los_naam,
    los_plaats: r.los_plaats,
    los_postcode: r.los_postcode,
    los_land: r.los_land,
    containertype: r.containertype,
    containernummer: r.containernummer,
    gewicht_kg: r.gewicht_kg,
    is_adr: r.is_adr,
    basis_tarief: r.basis_tarief,
    adr_toeslag: r.adr_toeslag,
    diesel_toeslag: r.diesel_toeslag,
    wachtuur_aantal: r.wachtuur_aantal,
    wachtuur_tarief: r.wachtuur_tarief,
    overige_toeslagen: r.overige_toeslagen || {},
    totaal_bedrag: r.totaal_bedrag,
    kilometers: r.kilometers,
    chauffeur: r.chauffeur,
    voertuig: r.voertuig,
    raw: r.raw,
  }));

  // Per batch van 500 om Supabase niet te overladen
  let geslaagd = 0;
  let foutMelding = null;
  for (let i = 0; i < ritten.length; i += 500) {
    const batch = ritten.slice(i, i + 500);
    const { error: insertError, count } = await supabase
      .from('historische_ritten')
      .insert(batch, { count: 'exact' });
    if (insertError) {
      foutMelding = insertError.message;
      break;
    }
    geslaagd += (count ?? batch.length);
  }

  await supabase
    .from('tarief_imports')
    .update({
      aantal_geslaagd: geslaagd,
      aantal_skipped: ritten.length - geslaagd,
      status: foutMelding ? 'fout' : 'verwerkt',
      fout_melding: foutMelding,
    })
    .eq('id', importRow.id);

  return res.status(200).json({
    ok: !foutMelding,
    import_id: importRow.id,
    klant: klantLower,
    totaal_rijen: parsed.totaalRijen,
    geslaagd,
    skipped: ritten.length - geslaagd,
    fout: foutMelding,
    niet_herkende_kolommen: parsed.niet_herkend,
    overige_toeslagen_kolommen: parsed.overigeKolommen,
  });
}
