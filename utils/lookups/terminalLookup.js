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

export async function getTerminalInfoFallback(inputNaam) {
  try {
    if (!inputNaam || typeof inputNaam !== 'string') return '0';

    const url = `${SUPABASE_LIST_URL}/op_afzetten.json`;
    const res = await fetch(url);
    const lijst = await res.json();

    const normInput = inputNaam.toLowerCase().replace(/\s+/g, '').trim();

    // Zoek op alternatieve namen of adresvelden die bestaan
    const gevonden = lijst.find(item =>
      [item.terminal, item.referentie, item.adres, ...(item.altNamen || [])]
        .filter(Boolean)
        .some(val =>
          val.toLowerCase().replace(/\s+/g, '').trim().includes(normInput)
        )
    );

    return gevonden?.terminal || '0';
  } catch (e) {
    console.error('❌ getTerminalInfoFallback error:', e);
    return '0';
  }
}

export async function getRederijNaam(rederij) {
  try {
    if (!rederij || typeof rederij !== 'string') return '0';
    const url = `${SUPABASE_LIST_URL}/rederijen.json`;
    const res = await fetch(url);
    const lijst = await res.json();
    const norm = rederij.toLowerCase().replace(/\s+/g, '').trim();
    const gevonden = lijst.find(i =>
      i.naam?.toLowerCase().replace(/\s+/g, '').trim() === norm
);
   return gevonden?.code || '0';
  } catch (e) {
    console.error('❌ getRederijNaam error:', e);
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