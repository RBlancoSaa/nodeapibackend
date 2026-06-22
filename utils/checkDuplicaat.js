// utils/checkDuplicaat.js
// Controleert of een container/klant-referentie al eerder succesvol is verwerkt
// (staat al op het planbord / is al door de parser herkend). Wordt gebruikt in
// handlers om update-emails te herkennen én te tonen WAT er gewijzigd is.

import { supabase } from '../services/supabaseClient.js';

const LOG_VELDEN =
  'ritnummer, containernummer, datum, tijd, klant_naam, klant_plaats, ' +
  'laadreferentie, inleverreferentie, opzet_naam, opzet_adres, ' +
  'afzet_naam, afzet_adres, containertype, bron, created_at';

/**
 * Zoek de meest recente succesvolle verwerking van deze opdracht.
 * Primair op containernummer; als die er niet is (of niets matcht) valt hij
 * terug op het klant-ritnummer — zodat re-sends/updates zonder containernummer
 * (bijv. exports) ook herkend worden.
 *
 * @param {string} containernummer
 * @param {string} [bron]        - optioneel: filter op bron (bijv. 'Ritra')
 * @param {string} [ritnummer]   - optioneel: klant-referentie voor fallback-match
 * @returns {object|null}  - volledige vorige log-rij of null
 */
export async function checkDuplicaat(containernummer, bron = null, ritnummer = null) {
  const zoek = async (kolom, waarde) => {
    let q = supabase
      .from('opdrachten_log')
      .select(LOG_VELDEN)
      .eq(kolom, waarde)
      .eq('status', 'OK')
      .order('created_at', { ascending: false })
      .limit(1);
    if (bron) q = q.eq('bron', bron);
    const { data, error } = await q;
    if (error) { console.warn(`⚠️ checkDuplicaat query fout: ${error.message}`); return null; }
    return data && data.length ? data[0] : null;
  };

  try {
    // 1. Containernummer (betrouwbaarste sleutel)
    if (containernummer && containernummer.length >= 6) {
      const viaCntr = await zoek('containernummer', containernummer);
      if (viaCntr) return viaCntr;
    }
    // 2. Fallback op ritnummer — alleen als er GEEN containernummer is, zodat
    //    losse containers binnen één multi-container-order niet ten onrechte als
    //    elkaars update worden gezien.
    const heeftCntr = !!(containernummer && containernummer.length >= 6);
    if (!heeftCntr && ritnummer && String(ritnummer).length >= 4 && ritnummer !== '0') {
      const viaRit = await zoek('ritnummer', ritnummer);
      if (viaRit) return viaRit;
    }
    return null;
  } catch (e) {
    console.warn('⚠️ checkDuplicaat mislukt:', e.message);
    return null;
  }
}

// ── Helpers om locatie-velden uit een container te halen (zelfde logica als logOpdracht) ──
function locatieNaam(container, actie) {
  return (container.locaties || []).find(l => (l.actie || '').toLowerCase() === actie)?.naam || '';
}
function laadLosNaam(container) {
  return (container.locaties || []).find(l => {
    const a = (l.actie || '').toLowerCase();
    return (a === 'laden' || a === 'lossen') && (l.naam || '').toUpperCase() !== 'OMRIJDER';
  })?.naam || '';
}

/**
 * Vergelijkt de vorige verwerking (uit opdrachten_log) met de nieuwe container
 * en geeft een lijst van leesbare wijzigingen terug: "Veld: oud → nieuw".
 * Alleen velden die écht verschillen (beide bekend) worden gemeld.
 *
 * @param {object} vorigeEntry - resultaat van checkDuplicaat()
 * @param {object} container   - de nieuwe container die naar XML gaat
 * @returns {string[]}
 */
export function buildUpdateDiff(vorigeEntry, container = {}) {
  if (!vorigeEntry || !container) return [];
  const norm  = v => (v == null ? '' : String(v)).trim();
  const stripT = t => norm(t).replace(/:00$/, '');

  const velden = [
    ['Datum',           vorigeEntry.datum,             container.datum],
    ['Tijd',            stripT(vorigeEntry.tijd),      stripT(container.tijd)],
    ['Ritnummer',       vorigeEntry.ritnummer,         container.ritnummer],
    ['Laadreferentie',  vorigeEntry.laadreferentie,    container.laadreferentie],
    ['Inleverreferentie', vorigeEntry.inleverreferentie, container.inleverreferentie],
    ['Containertype',   vorigeEntry.containertype,     container.containertype],
    ['Opzet-locatie',   vorigeEntry.opzet_naam,        locatieNaam(container, 'opzetten')],
    ['Afzet-locatie',   vorigeEntry.afzet_naam,        locatieNaam(container, 'afzetten')],
    ['Klant',           vorigeEntry.klant_naam,        laadLosNaam(container)],
  ];

  const wijzigingen = [];
  for (const [label, oud, nieuw] of velden) {
    const o = norm(oud), n = norm(nieuw);
    // Alleen melden als beide kanten een waarde hebben én verschillen (case-insensitief).
    // (Een leeg "oud" of "nieuw" is meestal ontbrekende log-data, geen echte wijziging.)
    if (o && n && o.toLowerCase() !== n.toLowerCase()) {
      wijzigingen.push(`${label}: ${o} → ${n}`);
    }
  }
  return wijzigingen;
}

/**
 * Voegt een update-waarschuwing (incl. wat er gewijzigd is) toe aan
 * container.instructies (het .easy bestand). Roep aan VOOR generateXmlFromJson.
 * @param {object} container   - de container die naar XML gaat
 * @param {object|null} vorigeEntry - resultaat van checkDuplicaat(), of null
 * @param {string} mailSubject - email-onderwerp (voor keyword-detectie)
 */
export function voegUpdateInstructieToe(container, vorigeEntry, mailSubject = '') {
  const subjectIsUpdate = !!mailSubject &&
    /\b(update[d]?|correction[s]?|corrected|amendment|reschedule[d]?|revised|wijziging|gewijzigd|aanpassing)\b/i.test(mailSubject);

  if (!vorigeEntry && !subjectIsUpdate) return;

  let melding = '⚠️ UPDATE';
  if (vorigeEntry) {
    const datumStr = vorigeEntry.datum || '?';
    const tijdStr  = vorigeEntry.tijd ? vorigeEntry.tijd.replace(/:00$/, '') : '';
    melding += ` — eerder verwerkt op ${datumStr}${tijdStr ? ` om ${tijdStr}` : ''}`;
    const diff = buildUpdateDiff(vorigeEntry, container);
    melding += diff.length
      ? ` | Gewijzigd: ${diff.join('; ')}`
      : ' | (geen velden gewijzigd t.o.v. vorige)';
  }

  container.instructies = container.instructies
    ? `${melding} | ${container.instructies}`
    : melding;
}

/**
 * Bouw de update-melding tekst op voor in de e-mail body, incl. de diff.
 * @param {object} vorigeEntry - resultaat van checkDuplicaat()
 * @param {object|string} container - de nieuwe container (object) of het containernummer (string)
 * @returns {string}
 */
export function buildUpdateMelding(vorigeEntry, container) {
  const isObj = container && typeof container === 'object';
  const containernummer = isObj ? (container.containernummer || '') : (container || '');
  const datumStr = vorigeEntry.datum || '?';
  const tijdStr  = vorigeEntry.tijd  ? vorigeEntry.tijd.replace(/:00$/, '') : '';
  const wanneer  = tijdStr ? `${datumStr} om ${tijdStr}` : datumStr;
  const klant    = [vorigeEntry.klant_naam, vorigeEntry.klant_plaats].filter(Boolean).join(', ');
  const ritnr    = vorigeEntry.ritnummer ? ` (ritnr: ${vorigeEntry.ritnummer})` : '';

  let tekst = `⚠️ LET OP: dit is een update\n\n`;
  tekst += containernummer
    ? `Container ${containernummer} is al eerder verwerkt${ritnr}.\n`
    : `Deze opdracht${ritnr} is al eerder verwerkt.\n`;
  tekst += `Vorige verwerking: ${wanneer}`;
  if (klant) tekst += ` — ${klant}`;
  tekst += '\n';

  if (isObj) {
    const diff = buildUpdateDiff(vorigeEntry, container);
    tekst += diff.length
      ? `\nWat is gewijzigd:\n${diff.map(d => `  • ${d}`).join('\n')}\n`
      : `\n(Geen inhoudelijke wijzigingen gedetecteerd t.o.v. de vorige verwerking.)\n`;
  }
  return tekst;
}
