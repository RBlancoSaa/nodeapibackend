// handlers/handleLeegmelding.js
// Verwerkt leegmeldingen van Steinweg en DFDS — logt naar de `leegmeldingen` tabel in Supabase.
import { supabase } from '../services/supabaseClient.js';

/** Bekende Steinweg-locatiecodes */
const STEINWEG_LOCATIES = {
  wp2:  'Waalhaven Pier 2',
  wp3:  'Waalhaven Pier 3',
  ppl:  'Parmentierplein',
  rdc:  'RDC Rotterdam',
  ectp: 'ECT Delta Terminal',
  uct:  'UCT Rotterdam',
  apm:  'APM Terminals Maasvlakte',
  rtm:  'Rotterdam Terminal',
  euro: 'Euromax Terminal',
};

/**
 * Parseert een Steinweg-leegmelding.
 * Subjectpatronen:
 *   "61550524 = leeg"
 *   "Containers order 62686235 zijn leeg"
 * Bodypatroon (eerste regel):
 *   "=leeg wp2, staan al in de kosten graag zsm retour brengen."
 *   "=leeg ppl, laatste vrije dag is 07/05 graag zsm omrijden."
 */
function parseSteinwegLeegmelding(mail) {
  const subject = mail.subject || '';
  const body    = (mail.bodyText || '').trim();

  // Ordernummer uit onderwerp
  const orderMatch  = subject.match(/(\d{7,})/);
  const ordernummer = orderMatch ? orderMatch[1] : null;

  // Eerste regel van body: "=leeg [code], rest..."
  const eersteRegel = body.split(/[\r\n]/)[0].trim();
  const bodyMatch   = eersteRegel.match(/^=leeg\s+([a-z0-9]+)[,\s]*(.*)/i);
  const locatieCode = bodyMatch ? bodyMatch[1].toLowerCase() : null;
  const rest        = bodyMatch ? bodyMatch[2].trim() : eersteRegel.replace(/^=leeg\s*/i, '').trim();
  const locatieNaam = locatieCode ? (STEINWEG_LOCATIES[locatieCode] || locatieCode.toUpperCase()) : null;

  // Laatste vrije dag: "laatste vrije dag is 07/05" of "vrije dag 07/05"
  const vrijeDagMatch  = rest.match(/(?:laatste\s+)?vrije\s+dag\s+(?:is\s+)?(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i);
  const laatste_vrije_dag = vrijeDagMatch ? vrijeDagMatch[1] : null;

  // Instructie = rest van de eerste zin (na de locatiecode)
  const instructie = rest || null;

  return { bron: 'Steinweg', ordernummer, locatieCode, locatieNaam, laatste_vrije_dag, instructie };
}

/**
 * Parseert een DFDS-leegmelding.
 * Bodypatroon:
 *   "Hereby we confirm we have unloaded the goods and so the container may be transported..."
 *   "Container No.   : EGSU6610429"
 *   "Container Type : 40FT-HC"
 */
function parseDFDSLeegmelding(mail) {
  const body = mail.bodyText || '';

  // Containernummer: "Container No. : EGSU6610429" (met variabele spaties/punten)
  const cntrMatch      = body.match(/Container\s+No\.?\s*:+\s*([A-Z]{4}\d{7})/i);
  const containernummer = cntrMatch ? cntrMatch[1].toUpperCase() : null;

  // Containertype: "Container Type : 40FT-HC" — neem alles tot regelboort, trim
  const typeMatch    = body.match(/Container\s+Type\s*:+\s*([^\r\n]+)/i);
  const containertype = typeMatch ? typeMatch[1].trim() : null;

  return { bron: 'DFDS', containernummer, containertype };
}

/**
 * Verwerkt één leegmelding-email.
 * @param {object} mail - { from, subject, bodyText }
 * @returns {{ klant: string, leegmelding: object }}
 */
export default async function handleLeegmelding(mail) {
  const from = (mail.from || '');
  const body = (mail.bodyText || '');

  let leegmelding;
  let klant;

  // DFDS herkennen op afzender of body-patroon
  if (
    /@dfds\.com/i.test(from) ||
    /@dfds-logistics\.com/i.test(from) ||
    /hereby\s+we\s+confirm\s+we\s+have\s+unloaded/i.test(body)
  ) {
    leegmelding = parseDFDSLeegmelding(mail);
    klant = 'DFDS';
  } else {
    // Steinweg (standaard als de leegmelding-check niet matcht op DFDS)
    leegmelding = parseSteinwegLeegmelding(mail);
    klant = 'Steinweg';
  }

  const ref = leegmelding.containernummer || leegmelding.ordernummer || '(geen ref)';
  console.log(`🟡 Leegmelding [${klant}] — ${ref}:`, JSON.stringify(leegmelding));

  try {
    const { error } = await supabase.from('leegmeldingen').insert([{
      bron:               leegmelding.bron,
      email_van:          mail.from    || '',
      email_subject:      mail.subject || '',
      containernummer:    leegmelding.containernummer   || null,
      containertype:      leegmelding.containertype     || null,
      ordernummer:        leegmelding.ordernummer       || null,
      locatie_code:       leegmelding.locatieCode       || null,
      locatie_naam:       leegmelding.locatieNaam       || null,
      laatste_vrije_dag:  leegmelding.laatste_vrije_dag || null,
      instructie:         leegmelding.instructie        || null,
      raw_body:           body.slice(0, 1000),
    }]);

    if (error) {
      console.error('⚠️ Leegmelding opslaan mislukt:', error.message);
    } else {
      console.log(`✅ Leegmelding opgeslagen [${klant}]: ${ref}`);
    }
  } catch (e) {
    console.error('⚠️ handleLeegmelding Supabase fout:', e.message);
  }

  return { klant, leegmelding };
}
