// utils/notifyError.js

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function notifyError(attachment, message) {
  const log = {
    tijd: new Date().toISOString(),
    bestandsnaam: attachment?.filename || 'onbekend',
    referentie: attachment?.reference || 'onbekend',
    foutmelding: message
  };

  console.error('🚨 ERROR MELDING:', log);

  const { error } = await supabase
    .from('error_logs')
    .insert([log]);

  if (error) {
    console.error('❌ Supabase fout bij opslaan errorlog:', error.message);
  } else {
    console.log('✅ Errorlog succesvol opgeslagen in Supabase');
  }
}
