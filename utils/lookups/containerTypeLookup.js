import '../../utils/fsPatch.js';
import { supabase } from '../../services/supabaseClient.js';

export async function getContainerTypeCode(type) {
  try {
    if (!type || typeof type !== 'string') return null;

    const { data, error } = await supabase
      .from('containers')
      .select('*')
      .ilike('code', `%${type}%`);

    if (error || !data || data.length === 0) return null;
    return data[0].code || null;
  } catch (err) {
    return null;
  }
}
