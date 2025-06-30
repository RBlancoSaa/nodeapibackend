import '../../utils/fsPatch.js';
import { supabase } from '../../services/supabaseClient.js'; // correcte pad én vorm

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
