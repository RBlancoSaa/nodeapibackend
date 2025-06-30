// services/terminalLookup.js
import '../fsPatch.js'; // 🚨 Moet altijd als eerste
import { supabase } from '../supabaseClient.js';

/**
 * Haal terminalinfo op uit Supabase tabel 'referentielijsten/op_afzetten.json'
 * @param {string} referentie - klantreferentie zoals 'OE2516811'
 * @returns {object|null} terminalinfo of null
 */
export async function getTerminalInfo(referentie) {
  try {
    if (!referentie || typeof referentie !== 'string') {
      console.warn('⚠️ Ongeldige referentie voor terminalLookup:', referentie);
      return null;
    }

    const { data, error } = await supabase
      .from('referentielijsten/op_afzetten')
      .select('*')
      .ilike('referentie', `%${referentie}%`);

    if (error) {
      console.error('❌ Supabase fout bij ophalen terminalinfo:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ Geen terminal gevonden voor referentie:', referentie);
      return null;
    }

    console.log(`📦 Terminalinformatie gevonden voor ${referentie}:`, data[0]);
    return data[0];
  } catch (err) {
    console.error('❌ Fout in getTerminalInfo:', err);
    return null;
  }
}
