// utils/lookups/terminalLookup.js
import '../../utils/fsPatch.js';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPABASE_LIST_URL = process.env.SUPABASE_LIST_PUBLIC_URL?.replace(/\/$/, '');

export function normalizeContainerOmschrijving(str) {
  return (str || '')
    .toLowerCase()
    .replace(/^(\d+)\s*x\s*/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export async function getTerminalInfo(referentie) {
  try {
    if (!referentie || typeof referentie !== 'string') return '0';
    const url = `${SUPABASE_LIST_URL}/op_afzetten.json`;
    const res = await fetch(url);
    const lijst = await res.json();
    const norm = referentie.toLowerCase().replace(/\s+/g, '').trim();
    const gevonden = lijst.find(i =>
      i.referentie?.toLowerCase().replace(/\s+/g, '').trim() === norm
    );
return gevonden?.terminal || '0';
  } catch (e) {
    console.error('❌ getTerminalInfo error:', e);
    return '0';
  }
}

export async function getTerminalInfoFallback(zoekwaarde) {
  try {
    if (!zoekwaarde || typeof zoekwaarde !== 'string') return '0';

    const url = `${SUPABASE_LIST_URL}/op_afzetten.json`;
    const res = await fetch(url);
    const lijst = await res.json();
    const normZoek = zoekwaarde.toLowerCase().replace(/\s+/g, '').trim();

    // Scorende match op altNamen en adresfragment
    const kandidaten = lijst
      .map((item) => {
        const altMatch = (item.altNamen || []).some(alt =>
          alt.toLowerCase().replace(/\s+/g, '').includes(normZoek)
        );
        const adresMatch = item.adres?.toLowerCase().includes(zoekwaarde.toLowerCase()) || false;

        const score = [
          item.naam,
          item.adres,
          item.postcode,
          item.plaats,
          item.portbase_code,
          item.bicsCode
        ].filter(Boolean).length;

        return {
          terminal: item,
          matched: altMatch || adresMatch,
          score
        };
      })
      .filter(k => k.matched)
      .sort((a, b) => b.score - a.score);

    if (kandidaten.length > 0) return kandidaten[0].terminal;
    return '0';

  } catch (e) {
    console.error('❌ getTerminalInfoFallback error:', e);
    return '0';
  }
}

export async function getTerminalInfoMetFallback(key) {
  try {
    if (!key || typeof key !== 'string' || key.trim() === '') return {};

    let info = await getTerminalInfo(key);

    // Als het antwoord '0' is of geen portbase_code bevat: gebruik fallback
    if (!info || info === '0' || !info.portbase_code) {
      const fallback = await getTerminalInfoFallback(key);
      if (fallback && fallback !== '0') return fallback;
    }

    return info;
  } catch (e) {
    console.error('❌ getTerminalInfoMetFallback error:', e);
    return {};
  }
}

    // REDERIJEN
export async function getRederijNaam(input) {
  try {
    if (!input || typeof input !== 'string') return '0';

    const norm = input.toLowerCase().trim();
    const url = `${SUPABASE_LIST_URL}/rederijen.json`;
    const res = await fetch(url);
    const lijst = await res.json();

    // Zoek op exacte of altLabel match
    let besteMatch = null;
    let hoogsteScore = 0;

    for (const item of lijst) {
      const opties = [
        item.naam,
        item.code,
        ...(item.altLabels || [])
      ];

      for (const optie of opties) {
        if (!optie) continue;
        const optieNorm = optie.toLowerCase().replace(/[^a-z0-9]/g, '').trim();

        if (optieNorm === norm) return item.naam;
        if (!besteMatch && norm.includes(optieNorm)) {
           besteMatch = item.naam;
          }
        if (besteMatch) return besteMatch;

        if (norm.includes(optieNorm) || optieNorm.includes(norm)) {
          // ⬆️ ook als "COSCO SHIPPING" in "COSCO CONTAINER" zit of andersom
          const score = optieNorm.length;
          if (score > hoogsteScore) {
            besteMatch = item.naam;
            hoogsteScore = score;
          }
        }
      }
    }

    if (besteMatch) {
      console.warn(`⚠️ Fuzzy match voor rederij "${input}" ➜ "${besteMatch}"`);
      return besteMatch;
    }

    console.warn(`❌ Geen rederij gevonden voor "${input}"`);
    return '0';
  } catch (err) {
    console.error('❌ Fout in getRederijNaam:', err);
    return '0';
  }
}


export async function getContainerTypeCode(type) {
  try {
    if (!type || typeof type !== 'string') return '0';

    const url = `${SUPABASE_LIST_URL}/containers.json`;
    const res = await fetch(url);
    const lijst = await res.json();

    const norm = normalizeContainerOmschrijving(type);

    for (const item of lijst) {
      const opties = [
        item.naam,
        item.label,
        ...(item.altLabels || [])
      ].map(normalizeContainerOmschrijving);

      if (opties.includes(norm)) return item.code;
    }

    return '0';
  } catch (e) {
    console.error('❌ getContainerTypeCode error:', e);
    return '0';
  }
}

export async function getKlantData(klantAlias) {
  try {
    const url = `${SUPABASE_LIST_URL}/klanten.json`;
    const res = await fetch(url);
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
      naam: gevonden.Bedrijfsnaam || klantAlias,
      adres: gevonden.Adres || '0',
      postcode: gevonden.Postcode || '0',
      plaats: gevonden.Plaats || '0',
      volledig: `${gevonden.Adres || ''}, ${gevonden.Postcode || ''} ${gevonden.Plaats || ''}`.trim(),
      telefoon: gevonden.Telefoon || '',
      email: gevonden.Email || '',
      btw: gevonden.BTW_nummer || '',
      kvk: gevonden['Deb. nr'] || ''
    };

    
  } catch (e) {
    console.error('❌ getKlantData error:', e);
    return {};
  }
}