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
  try {
    const url = `${SUPABASE_LIST_URL}/klanten.json`;
    const res = await fetch(url);
    const lijst = await res.json();

    const gevonden = lijst.find(item =>
      item.Bedrijfsnaam?.toLowerCase().includes(klantAlias.toLowerCase())
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