/**
 * utils/getPrijsafspraken.js
 *
 * Haalt de prijsafspraken voor een klant op uit de Supabase `prijsafspraken` tabel.
 * In-memory cache van 60 seconden zodat elke container-parse geen extra DB-call kost.
 *
 * Gebruik:
 *   const afspraken = await getPrijsafspraken('steinweg');
 *   afspraken.velden.diesel.chart  → 9
 *   afspraken.all_in               → false
 *   afspraken.toeslag('delta')     → 28.50 (of 0 als niet actief / all_in)
 */
import { supabase } from '../services/supabaseClient.js';

const _cache = new Map(); // klant → { data, exp }
const TTL = 60_000;       // 60 seconden

// Standaard-toeslagen als er geen record in Supabase is
const DEFAULTS = {
  diesel:     { chart: 9,    label: 'Diesel toeslag',    actief: true  },
  delta:      { chart: 28.5, label: 'ECT Delta toeslag', actief: true  },
  euromax:    { chart: 28.5, label: 'Euromax toeslag',   actief: true  },
  rwg:        { chart: 31,   label: 'RWG toeslag',       actief: true  },
  adr:        { chart: 0,    label: 'ADR toeslag',       actief: false },
  genset:     { chart: 0,    label: 'Genset',            actief: false },
  gasmeten:   { chart: 0,    label: 'Gasmeten',          actief: false },
  extra_stop: { chart: 0,    label: 'Extra stop',        actief: false },
  botlek:     { chart: 0,    label: 'Botlek toeslag',    actief: false },
  wacht_uur:  { chart: 0,    label: 'Wachtuurtoeslag',   actief: false },
  blanco1:    { chart: 0, text: '', label: 'Blanco 1',   actief: false },
  blanco2:    { chart: 0, text: '', label: 'Blanco 2',   actief: false },
};

export async function getPrijsafspraken(klantKey) {
  const key = (klantKey || '').toLowerCase().trim();

  // Cache-hit?
  const cached = _cache.get(key);
  if (cached && Date.now() < cached.exp) return cached.data;

  try {
    const { data, error } = await supabase
      .from('prijsafspraken')
      .select('*')
      .eq('klant', key)
      .single();

    if (error || !data) {
      console.warn(`⚠️ Geen prijsafspraken voor "${key}" — gebruik defaults`);
      const result = buildAfspraken({ klant: key, velden: DEFAULTS, all_in: false });
      _cache.set(key, { data: result, exp: Date.now() + TTL });
      return result;
    }

    const result = buildAfspraken(data);
    _cache.set(key, { data: result, exp: Date.now() + TTL });
    return result;

  } catch (e) {
    console.error('❌ getPrijsafspraken error:', e.message);
    return buildAfspraken({ klant: key, velden: DEFAULTS, all_in: false });
  }
}

/** Cache leegmaken (bijv. na een save in het dashboard) */
export function invalidatePrijsafsprakenCache(klantKey) {
  if (klantKey) _cache.delete((klantKey||'').toLowerCase().trim());
  else _cache.clear();
}

function buildAfspraken(record) {
  const velden = { ...DEFAULTS, ...(record.velden || {}) };
  const all_in = !!record.all_in;

  return {
    klant:  record.klant,
    velden,
    all_in,

    /**
     * Geeft de toeslagwaarde terug voor een gegeven sleutel.
     * - Geeft 0 terug als toeslag niet actief is
     * - Geeft 0 als all_in=true EN het een terminal-toeslag is (delta/euromax/rwg)
     *
     * @param {'delta'|'euromax'|'rwg'|'diesel'|'adr'|'genset'|'gasmeten'|'extra_stop'|'botlek'|'wacht_uur'|'blanco1'|'blanco2'} sleutel
     */
    toeslag(sleutel) {
      const v = velden[sleutel];
      if (!v || !v.actief) return 0;
      const terminalToeslagen = new Set(['delta', 'euromax', 'rwg', 'botlek']);
      if (all_in && terminalToeslagen.has(sleutel)) return 0;
      return v.chart ?? 0;
    },

    /** Geeft de tekstlabel terug voor blanco-toeslagen */
    toeslagText(sleutel) {
      return velden[sleutel]?.text || '';
    }
  };
}
