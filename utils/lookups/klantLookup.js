import '../../utils/fsPatch.js';
import { supabase } from '../../services/supabaseClient.js';

export async function getKlantData(klantnaamRuw) {
  try {
    if (!klantnaamRuw || typeof klantnaamRuw !== 'string') {
      console.warn('⚠️ Ongeldige klantnaam opgegeven voor lookup:', klantnaamRuw);
      return null;
    }

    const { data, error } = await supabase
      .from('klanten')
      .select('*')
      .ilike('naam', `%${klantnaam}%`);

    if (error) {
      console.error('❌ Supabase fout bij klant lookup:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.warn(`⚠️ Geen klantgegevens gevonden voor: ${klantnaamRuw}`);
      return null;
    }

    console.log(`👤 Klantgegevens gevonden voor "${klantnaamRuw}":`, data[0]);
    return data[0];
  } catch (err) {
    console.error('❌ Fout in getKlantData:', err);
    return null;
  }
}