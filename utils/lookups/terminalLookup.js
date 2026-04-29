// utils/lookups/terminalLookup.js
import '../../utils/fsPatch.js';
import fetch from 'node-fetch';
import { supabase } from '../../services/supabaseClient.js';

const SUPABASE_LIST_URL = process.env.SUPABASE_LIST_PUBLIC_URL?.replace(/\/$/, '');
const BUCKET        = 'referentielijsten';
const FILE_TERM     = 'op_afzetten.json';

// ─── Normalisatie ─────────────────────────────────────────────────────────────

export function normalizeContainerOmschrijving(str) {
  return (str || '').toLowerCase().replace(/^(\d+)\s*x\s*/i, '').replace(/[^a-z0-9]/g, '').trim();
}

/** Normaliseert landcodes zodat EasyTrip altijd "NL"/"DE"/"BE" krijgt, nooit de uitgeschreven naam */
export function normLand(val) {
  const s = (val || '').trim().toUpperCase();
  if (!s) return 'NL';
  if (s === 'NEDERLAND' || s === 'NETHERLANDS') return 'NL';
  if (s === 'DUITSLAND' || s === 'GERMANY' || s === 'DEUTSCHLAND') return 'DE';
  if (s === 'BELGIE' || s === 'BELGIË' || s === 'BELGIUM') return 'BE';
  return s;
}

/** Verwijdert trailing ".0" van numerieke velden uit Supabase (bijv. "8713755270896.0" → "8713755270896") */
export function cleanFloat(val) {
  if (!val) return '';
  return String(val).trim().replace(/\.0+$/, '');
}

/** Zorgt voor spatie in postcode (bijv. "3089KN" → "3089 KN") */
export function normPostcode(val) {
  return String(val || '').trim().replace(/^(\d{4})\s*([A-Z]{2})$/i, '$1 $2').toUpperCase();
}

function normStr(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Pakt de straatnaam uit een adres: "Bunschotenweg 200" → "bunschotenweg" */
function straatNaam(adres) {
  return (adres || '').trim().replace(/\s+\d.*$/, '').toLowerCase().replace(/[^a-z]/g, '');
}

// ─── Per-run cache (voorkomt herhaalde fetches binnen één aanroep) ─────────────

let _cache = null;
let _cacheTime = 0;

async function getTerminalLijst() {
  const nu = Date.now();
  if (_cache && nu - _cacheTime < 30_000) return _cache;
  const res = await fetch(`${SUPABASE_LIST_URL}/${FILE_TERM}`);
  _cache = await res.json();
  _cacheTime = nu;
  return _cache;
}

// ─── Score-berekening (naam + adres) ─────────────────────────────────────────

/**
 * Berekent hoe goed `zoekterm` overeenkomt met een terminal-entry.
 * Adres-match weegt zwaarder dan naam (adres is uniek, naam kan variëren).
 *
 *   100 = exacte naam-match
 *    90 = genormaliseerde naam-match
 *    80 = naam bevat zoekterm of vice versa
 *    65 = in altNamen gevonden
 *    50 = significante woordoverlap in naam
 *   +40 = exacte straatnaam-match in adres (bonus)
 *   +20 = gedeeltelijke straatnaam-match
 */
function berekenScore(zoek, terminal) {
  if (!zoek) return 0;
  const nZoek = normStr(zoek);
  const nNaam = normStr(terminal.naam || '');
  let score = 0;

  // Exacte naam
  if (nNaam && nNaam === nZoek) return 100;
  // Naam bevat zoekterm of omgekeerd (bijv. "united waalhaven" ↔ "unitedwaalhaventerminalsb")
  if (nNaam && (nNaam.includes(nZoek) || nZoek.includes(nNaam))) score = Math.max(score, 80);

  // Woordoverlap (woorden > 3 tekens)
  const wordsZ = zoek.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const wordsN = (terminal.naam || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const hits   = wordsZ.filter(w => wordsN.some(wn => wn.includes(w) || w.includes(wn)));
  if (hits.length > 0) score = Math.max(score, 40 + hits.length * 12);

  // altNamen
  const altHit = (terminal.altNamen || []).some(alt => {
    const nAlt = normStr(alt);
    return nAlt.includes(nZoek) || nZoek.includes(nAlt);
  });
  if (altHit) score = Math.max(score, 65);

  // Acroniem-check: "uwt" = U[nited] W[aalhaven] T[erminals], "apm" = A[PM] T[erminals]...
  if (nZoek.length >= 2 && nZoek.length <= 5) {
    const woorden = (terminal.naam || '').split(/\s+/).filter(w => w.length > 1);
    if (woorden.length >= nZoek.length) {
      const initialen = woorden.slice(0, nZoek.length).map(w => w[0].toLowerCase()).join('');
      if (initialen === nZoek) score = Math.max(score, 75);
    }
  }

  // ★ Adres-bonus — dit is het meest betrouwbare kenmerk
  const straatZ = straatNaam(zoek);
  const straatT = straatNaam(terminal.adres || '');
  if (straatZ && straatT) {
    if (straatZ === straatT)                                          score += 40;
    else if (straatT.includes(straatZ) || straatZ.includes(straatT)) score += 20;
  }

  return score;
}

// ─── Exacte lookup (naam of referentie) ───────────────────────────────────────

export async function getTerminalInfo(referentie) {
  try {
    if (!referentie || typeof referentie !== 'string') return '0';
    const lijst = await getTerminalLijst();
    const norm  = normStr(referentie);
    const gevonden = lijst.find(i =>
      normStr(i.referentie) === norm || normStr(i.naam) === norm
    );
    console.log(`🔍 getTerminalInfo("${referentie}") → ${gevonden ? gevonden.naam : 'niet gevonden'}`);
    return gevonden || '0';
  } catch (e) {
    console.error('❌ getTerminalInfo error:', e);
    return '0';
  }
}

// ─── Fuzzy lookup (naam + adres score) ────────────────────────────────────────

export async function getTerminalInfoFallback(zoekwaarde) {
  try {
    if (!zoekwaarde || typeof zoekwaarde !== 'string') return '0';
    const lijst = await getTerminalLijst();

    const beste = lijst
      .map(item => ({ item, score: berekenScore(zoekwaarde, item) }))
      .filter(s => s.score >= 65)
      .sort((a, b) => b.score - a.score)[0];

    if (beste) {
      console.log(`🔍 getTerminalInfoFallback("${zoekwaarde}") → ${beste.item.naam} (score ${beste.score})`);
      return beste.item;
    }
    return '0';
  } catch (e) {
    console.error('❌ getTerminalInfoFallback error:', e);
    return '0';
  }
}

// ─── Gecombineerde lookup (alleen uit lijst — nooit invullen) ─────────────────
/**
 * Zoekt een terminal in de lijst via exacte of fuzzy match.
 * Geeft null terug als niets gevonden — de parser beslist dan wat er in de
 * bijzonderheden/instructies komt. Er wordt NOOIT iets verzonnen.
 *
 * @param {string} key  - Terminalnaam uit PDF
 * @returns {object|null}
 */
export async function getTerminalInfoMetFallback(key) {
  try {
    const zoek = (key || '').trim();
    if (!zoek) return null;

    // 1. Exacte naam/referentie-match
    const exact = await getTerminalInfo(zoek);
    if (exact && exact !== '0') return exact;

    // 2. Fuzzy naam+adres match (drempel 65 om valse matches te vermijden)
    const fuzzy = await getTerminalInfoFallback(zoek);
    if (fuzzy && fuzzy !== '0') return fuzzy;

    console.log(`⚠️ Terminal niet gevonden in lijst: "${zoek}"`);
    return null;
  } catch (e) {
    console.error('❌ getTerminalInfoMetFallback error:', e);
    return null;
  }
}

// ─── Rederijen ────────────────────────────────────────────────────────────────

export async function getRederijNaam(input) {
  try {
    if (!input || typeof input !== 'string') return '0';
    const norm = input.toLowerCase().replace(/[^a-z0-9]/g, '');
    const res  = await fetch(`${SUPABASE_LIST_URL}/rederijen.json`);
    const lijst = await res.json();

    let besteMatch = null, hoogsteScore = 0;
    for (const item of lijst) {
      for (const optie of [item.naam, item.code, ...(item.altLabels || [])]) {
        if (!optie) continue;
        const optieNorm = optie.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (optieNorm === norm) return item.naam;
        const score = norm.includes(optieNorm) || optieNorm.includes(norm) ? optieNorm.length : 0;
        if (score > hoogsteScore) { besteMatch = item.naam; hoogsteScore = score; }
      }
    }
    if (besteMatch) {
      console.warn(`⚠️ Fuzzy match rederij "${input}" ➜ "${besteMatch}"`);
      return besteMatch;
    }
    console.warn(`❌ Geen rederij gevonden voor "${input}"`);
    return '0';
  } catch (err) {
    console.error('❌ Fout in getRederijNaam:', err);
    return '0';
  }
}

// ─── Containertype code ───────────────────────────────────────────────────────

export async function getContainerTypeCode(input) {
  if (!input) return '0';

  const mappingKey = input.toLowerCase().replace(/[\s\-'"]/g, '');
  if (mappingKey === '40fthc') return '45G1';
  if (mappingKey === '45fthc' || mappingKey === '45fthighcube' || mappingKey === 'l5g1') return '45G1';

  let normalizedInput = mappingKey;
  if (/^20\s*ft|20ft/.test(input.toLowerCase())) normalizedInput = '20ft';
  if (/^40\s*ft|40ft/.test(input.toLowerCase())) normalizedInput = '40ft';
  if (/^45\s*ft|45ft/.test(input.toLowerCase())) normalizedInput = '45ft';

  const isReefer = /r\b|reefer|temperatuur/i.test(input);

  let lijst = [];
  try {
    const res = await fetch(`${SUPABASE_LIST_URL}/containers.json`);
    lijst = await res.json();
  } catch (err) {
    console.error('❌ Fout bij ophalen containers.json:', err);
    return '0';
  }

  for (const type of lijst) {
    for (const label of [type.label, type.code, ...(type.altLabels || [])]) {
      const normalized = (label || '').toLowerCase().replace(/[\s\-'"]/g, '');
      if (normalized === normalizedInput) {
        if (isReefer  && !type.code.includes('R')) continue;
        if (!isReefer &&  type.code.includes('R')) continue;
        console.log('✅ Containertype match gevonden:', type.code, 'via:', label);
        return type.code;
      }
    }
  }
  return '0';
}

// ─── Adresboek (centrale lookup voor klanten, charters, lossen/laden) ────────

let _adresboekCache = null;
let _adresboekCacheTime = 0;

async function getAdresboekLijst() {
  const nu = Date.now();
  if (_adresboekCache && nu - _adresboekCacheTime < 30_000) return _adresboekCache;
  try {
    const res = await fetch(`${SUPABASE_LIST_URL}/adresboek.json`);
    _adresboekCache = await res.json();
    _adresboekCacheTime = nu;
  } catch (e) {
    console.error('❌ adresboek.json ophalen mislukt:', e.message);
    _adresboekCache = [];
  }
  return _adresboekCache;
}

/**
 * Zoekt een adres in het centrale adresboek via naam + optioneel adres.
 * Het adres is het primaire kenmerk: een sterke adres-match compenseert een zwakkere naamovereenkomst.
 *
 * @param {string} zoekNaam   - Naam zoals die in de PDF/mail staat
 * @param {string} [type]     - Optioneel: filter op Type ('Klant', 'Charter', …)
 * @param {string} [zoekAdres]- Optioneel: straatadres uit PDF ter verificatie
 * @returns {{ naam, adres, postcode, plaats, telefoon, mobiel, email, type }|null}
 */
export async function getAdresboekEntry(zoekNaam, type = null, zoekAdres = '') {
  try {
    if (!zoekNaam || zoekNaam.trim().length < 2) return null;
    const lijst = await getAdresboekLijst();
    const gefilterd = type ? lijst.filter(i => i.type?.toLowerCase() === type.toLowerCase()) : lijst;

    const nZoek  = normStr(zoekNaam);
    const wordsZoek = zoekNaam.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const straatZoek = straatNaam(zoekAdres);   // bijv. "nieuwesluisweg"

    let besteScore = 0;
    let besteEntry = null;

    for (const item of gefilterd) {
      const nNaam = normStr(item.naam || '');
      let score = 0;

      // ── Naam-score ──────────────────────────────────────────────────────────
      if (nNaam === nZoek) {
        score = 100;
      } else if (nNaam.includes(nZoek) || nZoek.includes(nNaam)) {
        score = 80;
      } else {
        const wordsNaam = (item.naam || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const hits = wordsZoek.filter(w => wordsNaam.some(wn => wn.includes(w) || w.includes(wn)));
        if (hits.length >= 2)                              score = 40 + hits.length * 15;
        else if (hits.length === 1 && hits[0].length >= 5) score = 40;
      }

      // ── Adres-bonus (meest betrouwbaar) ─────────────────────────────────────
      if (straatZoek) {
        const straatEntry = straatNaam(item.adres || '');
        if (straatZoek && straatEntry) {
          if (straatZoek === straatEntry)                                           score += 50;
          else if (straatEntry.includes(straatZoek) || straatZoek.includes(straatEntry)) score += 25;
        }
      }

      if (score > besteScore) { besteScore = score; besteEntry = item; }
      if (besteScore >= 150) break; // perfecte naam + adres match
    }

    // Minimumdrempel: naam-only ≥40 of adres-only ≥50
    if (!besteEntry || besteScore < 40) {
      console.log(`⚠️ Adresboek: geen match voor "${zoekNaam}"${zoekAdres ? ` @ ${zoekAdres}` : ''}${type ? ` [${type}]` : ''}`);
      return null;
    }
    console.log(`📒 Adresboek: "${zoekNaam}" → ${besteEntry.naam} [${besteEntry.type}] (score ${besteScore})`);
    return besteEntry;
  } catch (e) {
    console.error('❌ getAdresboekEntry error:', e);
    return null;
  }
}

// ─── Klantdata ────────────────────────────────────────────────────────────────

/**
 * Fuzzy klant-lookup op basis van woordoverlap in Bedrijfsnaam / zoekcode / alias.
 * Geeft het best-matchende klantobject terug, of null als niets gevonden.
 */
export async function getKlantDataFuzzy(naam) {
  try {
    if (!naam) return null;
    const res   = await fetch(`${SUPABASE_LIST_URL}/klanten.json`);
    const lijst = await res.json();

    const nZoek = naam.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    const wordsZoek = nZoek.split(/\s+/).filter(w => w.length > 2);

    let besteScore = 0;
    let besteKlant = null;

    for (const item of lijst) {
      const kandidaten = [item.Bedrijfsnaam, item.zoekcode, item.alias].filter(Boolean);
      for (const k of kandidaten) {
        const nK = k.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        // Exacte match
        if (nK === nZoek) {
          besteKlant = item; besteScore = 100; break;
        }
        // Woordoverlap
        const wordsK = nK.split(/\s+/).filter(w => w.length > 2);
        const hits = wordsZoek.filter(w => wordsK.some(wk => wk.includes(w) || w.includes(wk)));
        const score = hits.length >= 2 ? hits.length * 30 : (hits.length === 1 && hits[0].length >= 5 ? 30 : 0);
        if (score > besteScore) { besteScore = score; besteKlant = item; }
      }
      if (besteScore === 100) break;
    }

    if (!besteKlant || besteScore < 30) {
      console.log(`⚠️ Geen klant-fuzzy match voor "${naam}"`);
      return null;
    }
    console.log(`🔍 getKlantDataFuzzy("${naam}") → ${besteKlant.Bedrijfsnaam} (score ${besteScore})`);
    return {
      naam:     besteKlant.Bedrijfsnaam || naam,
      adres:    besteKlant.Adres     || '',
      postcode: besteKlant.Postcode  || '',
      plaats:   besteKlant.Plaats    || '',
      telefoon: besteKlant.Telefoon  || '',
      email:    besteKlant.Email     || '',
      btw:      besteKlant.BTW_nummer || '',
      kvk:      besteKlant['Deb. nr'] || ''
    };
  } catch (e) {
    console.error('❌ getKlantDataFuzzy error:', e);
    return null;
  }
}

export async function getKlantData(klantAlias) {
  try {
    const res   = await fetch(`${SUPABASE_LIST_URL}/klanten.json`);
    const lijst = await res.json();
    const gevonden = lijst.find(item =>
      [item.Bedrijfsnaam, item.zoekcode, item.alias]
        .filter(Boolean)
        .some(val => val.toLowerCase() === klantAlias.toLowerCase())
    );
    if (!gevonden) {
      console.warn(`⚠️ klant ${klantAlias} niet gevonden in klanten.json`);
      return {};
    }
    return {
      naam:     gevonden.Bedrijfsnaam || klantAlias,
      adres:    gevonden.Adres     || '0',
      postcode: gevonden.Postcode  || '0',
      plaats:   gevonden.Plaats    || '0',
      volledig: `${gevonden.Adres || ''}, ${gevonden.Postcode || ''} ${gevonden.Plaats || ''}`.trim(),
      telefoon: gevonden.Telefoon  || '',
      email:    gevonden.Email     || '',
      btw:      gevonden.BTW_nummer || '',
      kvk:      gevonden['Deb. nr'] || ''
    };
  } catch (e) {
    console.error('❌ getKlantData error:', e);
    return {};
  }
}
