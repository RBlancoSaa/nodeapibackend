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
      .filter(s => s.score >= 50)
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

// ─── Nieuwe terminal opslaan in Supabase Storage ─────────────────────────────

async function slaTerminalOp(data) {
  try {
    const lijst = await getTerminalLijst();

    // Voorkom duplicaten op naam+adres
    const bestaat = lijst.some(t =>
      normStr(t.naam) === normStr(data.naam) &&
      normStr(t.adres) === normStr(data.adres)
    );
    if (bestaat) return null;

    const nieuw = {
      naam:          (data.naam     || '').trim(),
      adres:         (data.adres    || '').trim(),
      postcode:      (data.postcode || '').trim(),
      plaats:        (data.plaats   || '').trim(),
      land:          (data.land     || 'NL'),
      portbase_code: '',
      bicsCode:      '',
      voorgemeld:    'nee',
      altNamen:      []
    };

    lijst.push(nieuw);
    _cache = lijst; // direct in cache

    const { error } = await supabase.storage
      .from(BUCKET)
      .update(FILE_TERM, JSON.stringify(lijst, null, 2), {
        contentType: 'application/json',
        upsert: true
      });

    if (error) console.error('❌ Nieuwe terminal opslaan mislukt:', error.message);
    else       console.log(`✅ Nieuwe terminal aangemaakt: "${nieuw.naam}" @ ${nieuw.adres}`);

    return nieuw;
  } catch (e) {
    console.error('❌ slaTerminalOp error:', e);
    return null;
  }
}

// ─── Gecombineerde lookup met auto-create ─────────────────────────────────────
/**
 * @param {string} key        - Terminalnaam uit PDF
 * @param {object} [rawData]  - Ruwe data uit PDF: { naam, adres, postcode, plaats }
 *                              Wordt gebruikt bij adres-fallback en auto-create.
 */
export async function getTerminalInfoMetFallback(key, rawData) {
  try {
    const zoek = (key || '').trim();
    if (!zoek && !rawData?.naam) return {};

    // 1. Exacte naam/referentie-match
    if (zoek) {
      const exact = await getTerminalInfo(zoek);
      if (exact && exact !== '0') return exact;
    }

    // 2. Fuzzy naam+adres match
    if (zoek) {
      const fuzzy = await getTerminalInfoFallback(zoek);
      if (fuzzy && fuzzy !== '0') return fuzzy;
    }

    // 3. Probeer ook op raw adres te matchen (straatnaambasis)
    if (rawData?.adres) {
      const adresFuzzy = await getTerminalInfoFallback(rawData.adres);
      if (adresFuzzy && adresFuzzy !== '0') return adresFuzzy;
    }

    // 4. Nog steeds niets → nieuwe terminal aanmaken
    if (rawData?.naam && rawData?.adres) {
      console.log(`📌 Onbekende terminal — aanmaken: "${rawData.naam}" @ ${rawData.adres}`);
      const nieuw = await slaTerminalOp(rawData);
      if (nieuw) return nieuw;
      // Bij schrijffout toch de raw data teruggeven
      return {
        naam:          rawData.naam     || '',
        adres:         rawData.adres    || '',
        postcode:      rawData.postcode || '',
        plaats:        rawData.plaats   || '',
        land:          'NL',
        portbase_code: '',
        bicsCode:      '',
        voorgemeld:    'nee'
      };
    }

    return rawData ? { naam: rawData.naam || '', adres: rawData.adres || '', land: 'NL', portbase_code: '', bicsCode: '', voorgemeld: 'nee' } : {};
  } catch (e) {
    console.error('❌ getTerminalInfoMetFallback error:', e);
    return rawData || {};
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

// ─── Klantdata ────────────────────────────────────────────────────────────────

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
