// utils/notifyError.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Logt een foutmelding naar de Supabase-tabel "error_logs"
 * @param {Object} att - Bijlage info (mag leeg object zijn)
 * @param {String} msg - De foutmelding
 */
export default async function notifyError(att = {}, msg = '') {
  const bestand = att.filename || 'onbekend.pdf';
  const referentie = att.referentie || 'geen referentie';
  const tijd = new Date().toISOString();

  console.log(`🪵 Logging error naar Supabase: ${msg}`);

  const { error } = await supabase
    .from('error_logs')
    .insert([
      {
        tijd,
        bestandsnaam: bestand,
        referentie,
        foutmelding: msg
      }
    ]);

  if (error) {
    console.error('❌ Kon fout niet loggen naar Supabase:', error.message);
  } else {
    console.log('✅ Fout gelogd in Supabase');
  }
}
