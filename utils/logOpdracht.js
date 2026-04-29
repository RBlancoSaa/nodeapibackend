// utils/logOpdracht.js
// Logt elke verwerkte container/opdracht naar de opdrachten_log tabel in Supabase.
import { supabase } from '../services/supabaseClient.js';

/**
 * @param {object} opts
 * @param {string} opts.bron           - 'DFDS' | 'Jordex' | 'Steinweg' | ...
 * @param {string} [opts.afzenderEmail]
 * @param {string} [opts.bestandsnaam]
 * @param {object} opts.container      - geparsed container-object
 * @param {string} [opts.easyBestand]  - gegenereerde .easy bestandsnaam
 * @param {'OK'|'FOUT'} [opts.status]
 * @param {string} [opts.foutmelding]
 */
export async function logOpdracht({ bron, afzenderEmail = '', bestandsnaam = '', container = {}, easyBestand = '', status = 'OK', foutmelding = '' }) {
  try {
    // Haal laad/los klantlocatie op uit locaties-array (actie = Laden of Lossen)
    const laadLosLocatie = (container.locaties || []).find(l =>
      l.actie === 'Laden' || l.actie === 'Lossen'
    );

    await supabase.from('opdrachten_log').insert([{
      bron,
      afzender_email:   afzenderEmail,
      bestandsnaam,
      ritnummer:        container.ritnummer        || '',
      containernummer:  container.containernummer  || '',
      containertype:    container.containertype    || '',
      datum:            container.datum            || '',
      klant_naam:       laadLosLocatie?.naam       || container.klantnaam  || '',
      klant_plaats:     laadLosLocatie?.plaats     || container.klantplaats || '',
      laadreferentie:   container.laadreferentie   || '',
      inleverreferentie: container.inleverreferentie || '',
      status,
      foutmelding,
      easy_bestand:     easyBestand
    }]);
  } catch (e) {
    // Logging mag nooit de verwerking stoppen
    console.error('⚠️ logOpdracht mislukt:', e.message);
  }
}
