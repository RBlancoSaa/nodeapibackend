// utils/checkDuplicaat.js
// Controleert of een containernummer al eerder succesvol is verwerkt.
// Wordt gebruikt in handlers om update-emails te herkennen.

import { supabase } from '../services/supabaseClient.js';

/**
 * Zoek de meest recente succesvolle verwerking van dit containernummer.
 * @param {string} containernummer
 * @param {string} [bron]  - optioneel: filter op bron (bijv. 'Ritra')
 * @returns {object|null}  - { ritnummer, datum, tijd, klant_naam, klant_plaats, bron, created_at } of null
 */
export async function checkDuplicaat(containernummer, bron = null) {
  if (!containernummer || containernummer.length < 6) return null;
  try {
    let query = supabase
      .from('opdrachten_log')
      .select('ritnummer, containernummer, datum, tijd, klant_naam, klant_plaats, bron, created_at')
      .eq('containernummer', containernummer)
      .eq('status', 'OK')
      .order('created_at', { ascending: false })
      .limit(1);

    if (bron) query = query.eq('bron', bron);

    const { data, error } = await query;
    if (error) {
      console.warn(`⚠️ checkDuplicaat query fout: ${error.message}`);
      return null;
    }
    if (!data || data.length === 0) return null;
    return data[0];
  } catch (e) {
    console.warn('⚠️ checkDuplicaat mislukt:', e.message);
    return null;
  }
}

/**
 * Bouw de update-melding tekst op voor in de e-mail body.
 * @param {object} vorigeEntry - resultaat van checkDuplicaat()
 * @param {string} containernummer
 * @returns {string}
 */
export function buildUpdateMelding(vorigeEntry, containernummer) {
  const datumStr = vorigeEntry.datum || '?';
  const tijdStr  = vorigeEntry.tijd  ? vorigeEntry.tijd.replace(/:00$/, '') : '';
  const wanneer  = tijdStr ? `${datumStr} om ${tijdStr}` : datumStr;
  const klant    = [vorigeEntry.klant_naam, vorigeEntry.klant_plaats].filter(Boolean).join(', ');
  const ritnr    = vorigeEntry.ritnummer ? ` (ritnr: ${vorigeEntry.ritnummer})` : '';

  let tekst = `⚠️ LET OP: dit is een update\n\n`;
  tekst += `Container ${containernummer} is al eerder verwerkt${ritnr}.\n`;
  tekst += `Vorige verwerking: ${wanneer}`;
  if (klant) tekst += ` — ${klant}`;
  tekst += '\n';
  return tekst;
}
