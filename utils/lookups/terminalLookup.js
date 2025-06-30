// utils/lookups/terminalLookup.js
import '../../utils/fsPatch.js';
import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPABASE_LIST_URL = process.env.SUPABASE_LIST_PUBLIC_URL?.replace(/\/$/, '');

export async function getTerminalInfo(referentie) {
  try {
    if (!referentie || typeof referentie !== 'string') return '0';
    const url = `${SUPABASE_LIST_URL}/op_afzetten.json`;
    const res = await fetch(url);
    const lijst = await res.json();
    const gevonden = lijst.find(i => i.referentie?.toLowerCase() === referentie.toLowerCase());
    return gevonden?.terminal || '0';
  } catch (e) {
    console.error('❌ getTerminalInfo error:', e);
    return '0';
  }
}

export async function getRederijNaam(rederij) {
  try {
    if (!rederij || typeof rederij !== 'string') return '0';
    const url = `${SUPABASE_LIST_URL}/rederijen.json`;
    const res = await fetch(url);
    const lijst = await res.json();
    const gevonden = lijst.find(i => i.naam?.toLowerCase() === rederij.toLowerCase());
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
    const gevonden = lijst.find(i => i.naam?.toLowerCase() === type.toLowerCase());
    return gevonden?.code || '0';
  } catch (e) {
    console.error('❌ getContainerTypeCode error:', e);
    return '0';
  }
}

export async function getKlantData(klantAlias) {
  const { data, error } = await supabase
    .from('klanten')
    .select('*')
    .ilike('Bedrijfsnaam', `%${klantAlias}%`);

  if (error || !data || data.length === 0) {
    console.warn(`⚠️ Supabase lookup gefaald voor klant: ${klantAlias}`, error || 'Geen data');
    return {};
  }

  const klant = data[0];

  return {
    naam: klant.Bedrijfsnaam || klantAlias,
    adres: klant.Adres || '0',
    postcode: klant.Postcode || '0',
    plaats: klant.Plaats || '0',
    volledig: `${klant.Adres || ''}, ${klant.Postcode || ''} ${klant.Plaats || ''}`.trim(),
    telefoon: klant.Telefoon || '',
    email: klant.Email || '',
    btw: klant.BTW_nummer || '',
    kvk: klant['Deb. nr'] || ''
  };
}