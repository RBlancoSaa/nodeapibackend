import '../fsPatch.js';;
import { supabase } from '../../services/supabaseClient.js';

/**
 * Haal klantgegevens op uit Supabase tabel 'referentielijsten/klanten'
 * @param {string} naam - klantnaam zoals 'Jordex'
 * @returns {object|null}
 */
export async function getKlantData(naam) {
  try {
    if (!naam || typeof naam !== 'string') {
      console.warn('⚠️ Ongeldige klantnaam opgegeven:', naam);
      return null;
    }

    const { data, error } = await supabase
      .from('referentielijsten/klanten')
      .select('*')
      .ilike('naam', `%${naam}%`);

    if (error) {
      console.error('❌ Supabase fout bij ophalen klantgegevens:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ Geen klant gevonden voor naam:', naam);
      return null;
    }

    console.log(`🏢 Klantgegevens gevonden voor ${naam}:`, data[0]);
    return data[0];
  } catch (err) {
    console.error('❌ Fout in getKlantData:', err);
    return null;
  }
}