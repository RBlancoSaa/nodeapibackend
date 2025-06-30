import '../utils/fsPatch.js';
import { supabase } from '../supabaseClient.js';

/**
 * Haal containertypecode op uit Supabase tabel 'referentielijsten/containertypes'
 * @param {string} input - bijv. '40DV' of '45R1'
 * @returns {string|null}
 */
export async function getContainerTypeCode(input) {
  try {
    if (!input || typeof input !== 'string') {
      console.warn('⚠️ Ongeldig containertype opgegeven:', input);
      return null;
    }

    const { data, error } = await supabase
      .from('referentielijsten/containertypes')
      .select('*')
      .ilike('code', `%${input}%`);

    if (error) {
      console.error('❌ Supabase fout bij ophalen containertype:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ Geen containertype gevonden voor:', input);
      return null;
    }

    console.log(`📦 Containertypecode gevonden voor ${input}:`, data[0].code);
    return data[0].code;
  } catch (err) {
    console.error('❌ Fout in getContainerTypeCode:', err);
    return null;
  }
}