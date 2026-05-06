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
 *
 * Formaat A (NL, meerdere containers):
 *   "MSNU7774185\t62680902"    ← containernummer TAB ordernummer
 *   (meerdere regels, één per container)
 *
 * Formaat B (EN, één container):
 *   "Container No.   : EGSU6610429"
 *   "Container Type : 40FT-HC"
 *
 * Geeft altijd een array terug (één object per container).
 */
function parseDFDSLeegmelding(mail) {
  const body = mail.bodyText || '';

  // Formaat A: regels met "[A-Z]{4}\d{7}  \d{6,}"
  const multiMatch = [...body.matchAll(/\b([A-Z]{4}\d{7})\b[\t ]+(\d{6,})/gi)];
  if (multiMatch.length > 0) {
    return multiMatch.map(m => ({
      bron: 'DFDS',
      containernummer: m[1].toUpperCase(),
      ordernummer:     m[2],
      containertype:   null,
    }));
  }

  // Formaat B: "Container No. : EGSU6610429"
  const cntrMatch     = body.match(/Container\s+No\.?\s*:+\s*([A-Z]{4}\d{7})/i);
  const typeMatch     = body.match(/Container\s+Type\s*:+\s*([^\r\n]+)/i);
  return [{
    bron:           'DFDS',
    containernummer: cntrMatch ? cntrMatch[1].toUpperCase() : null,
    containertype:   typeMatch ? typeMatch[1].trim() : null,
    ordernummer:     null,
  }];
}

/**
 * Verwerkt één leegmelding-email.
 * @param {object} mail - { from, subject, bodyText }
 * @returns {{ klant: string, leegmelding: object }}
 */
export default async function handleLeegmelding(mail) {
  const from = (mail.from || '');
  const body = (mail.bodyText || '');

  let leegmeldingen;
  let klant;

  // DFDS herkennen op afzender of body-patroon
  if (
    /@dfds\.com/i.test(from) ||
    /@dfds-logistics\.com/i.test(from) ||
    /hereby\s+we\s+confirm\s+we\s+have\s+unloaded/i.test(body) ||
    /(?:containers?\s+)?(?:zijn|is)\s+leeg\s+en\s+kunnen\s+worden\s+ingeleverd/i.test(body)
  ) {
    leegmeldingen = parseDFDSLeegmelding(mail); // array
    klant = 'DFDS';
  } else {
    leegmeldingen = [parseSteinwegLeegmelding(mail)]; // array van 1
    klant = 'Steinweg';
  }

  console.log(`🟡 Leegmelding [${klant}] — ${leegmeldingen.length} container(s)`);

  try {
    const rows = leegmeldingen.map(lm => ({
      bron:              lm.bron,
      email_van:         mail.from    || '',
      email_subject:     mail.subject || '',
      containernummer:   lm.containernummer   || null,
      containertype:     lm.containertype     || null,
      ordernummer:       lm.ordernummer       || null,
      locatie_code:      lm.locatieCode       || null,
      locatie_naam:      lm.locatieNaam       || null,
      laatste_vrije_dag: lm.laatste_vrije_dag || null,
      instructie:        lm.instructie        || null,
      raw_body:          body.slice(0, 1000),
    }));

    const { error } = await supabase.from('leegmeldingen').insert(rows);
    if (error) {
      console.error('⚠️ Leegmelding opslaan mislukt:', error.message);
    } else {
      console.log(`✅ ${rows.length} leegmelding(en) opgeslagen [${klant}]: ${leegmeldingen.map(l => l.containernummer || l.ordernummer || '?').join(', ')}`);
    }
  } catch (e) {
    console.error('⚠️ handleLeegmelding Supabase fout:', e.message);
  }

  return { klant, leegmelding: leegmeldingen[0] };
}
