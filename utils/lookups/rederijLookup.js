// rederijLookup.js
import '../../utils/fsPatch.js';
import { supabase } from '../../services/supabaseClient.js';

export async function getRederijNaam(rederijRuweNaam) {
  try {
    if (!rederijRuweNaam || typeof rederijRuweNaam !== 'string') {
      console.warn('⚠️ Ongeldige rederijnaam:', rederijRuweNaam);
      return null;
    }

    const { data, error } = await supabase
      .from('referentielijsten/rederijen')
      .select('*')
      .ilike('alias', `%${rederijRuweNaam}%`);

    if (error) {
      console.error('❌ Supabase fout bij rederij lookup:', error);
      return null;
    }

    if (!data || data.length === 0) {
      console.warn('⚠️ Geen rederij gevonden voor alias:', rederijRuweNaam);
      return null;
    }

    console.log(`🚢 Rederij gevonden voor "${rederijRuweNaam}":`, data[0].naam);
    return data[0].naam;
  } catch (err) {
    console.error('❌ Fout in getRederijNaam:', err);
    return null;
  }
}