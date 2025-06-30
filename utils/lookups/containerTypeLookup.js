import '../../utils/fsPatch.js';
import { supabase } from '../../services/supabaseClient.js';

export function getContainerTypeCode(line) {
  if (!line || typeof line !== 'string') return null;

  const match = line.match(/\b(22G1|22R1|42G1|45G1|45R1|42U1|LEG1)\b/i);
  const code = match ? match[1].toUpperCase() : null;

  if (code) {
    console.log(`📦 Containertype herkend: ${code}`);
  } else {
    console.warn(`⚠️ Geen containertype gevonden in regel:`, line);
  }

  return code;
}
