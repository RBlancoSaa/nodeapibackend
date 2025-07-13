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

    const norm = input.toLowerCase().replace(/[^a-z0-9]/g, '');
    const url = `${SUPABASE_LIST_URL}/rederijen.json`;
    const res = await fetch(url);
    const lijst = await res.json();

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
        const optieNorm = optie.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Exacte match
        if (optieNorm === norm) {
          return item.naam;
        }

        // Fuzzy match (substring in beide richtingen)
        const matchScore =
          norm.includes(optieNorm) || optieNorm.includes(norm)
            ? optieNorm.length
            : 0;

        if (matchScore > hoogsteScore) {
          besteMatch = item.naam;
          hoogsteScore = matchScore;
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

export async function getContainerTypeCode(input) {
  if (!input) return '0';

  const normalizedInput = input.toLowerCase().replace(/[\s\-'"]/g, '');

  const url = `${SUPABASE_LIST_URL}/containers.json`;
  let lijst = [];
  try {
    const res = await fetch(url);
    lijst = await res.json();
  } catch (err) {
    console.error('❌ Fout bij ophalen containers.json:', err);
    return '0';
  }

  for (const type of lijst) {
    const allLabels = [
      type.label,
      type.code,
      ...(type.altLabels || [])
    ];

    for (const label of allLabels) {
      const normalized = label.toLowerCase().replace(/[\s\-'"]/g, '');
      if (normalized === normalizedInput) {
        console.log('✅ Containertype match gevonden:', type.code, 'via:', label);
        return type.code;
      }
    }
  }

  console.warn('⚠️ Geen match voor containertype:', input);
  return '0';
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