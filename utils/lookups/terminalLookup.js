// utils/lookups/terminalLookup.js
import '../../utils/fsPatch.js';
import fetch from 'node-fetch';

const SUPABASE_LIST_URL = process.env.SUPABASE_LIST_PUBLIC_URL?.replace(/\/$/, '');

export async function getTerminalInfo(referentie) {
  try {
    if (!referentie || typeof referentie !== 'string') return '0';
    const url = `${SUPABASE_LIST_URL}/op_afzetten.json`;
    const res = await fetch(url);
    const lijst = await res.json();
    const gevonden = lijst.find(i => i.referentie?.toLowerCase() === referentie.toLowerCase());
    return gevonden?.terminal || '0';
  } catch (err) {
    console.error('❌ getTerminalInfo:', err);
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
  } catch (err) {
    console.error('❌ getRederijNaam:', err);
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
  } catch (err) {
    console.error('❌ getContainerTypeCode:', err);
    return '0';
  }
}

export async function getKlantData(klantnaam) {
  try {
    if (!klantnaam || typeof klantnaam !== 'string') return {
      adres: '0', postcode: '0', plaats: '0', volledig: '0'
    };
    const url = `${SUPABASE_LIST_URL}/klanten.json`;
    const res = await fetch(url);
    const lijst = await res.json();
    const gevonden = lijst.find(i => i.naam?.toLowerCase() === klantnaam.toLowerCase());
    return {
      adres: gevonden?.adres || '0',
      postcode: gevonden?.postcode || '0',
      plaats: gevonden?.plaats || '0',
      volledig: gevonden?.volledig || '0'
    };
  } catch (err) {
    console.error('❌ getKlantData:', err);
    return {
      adres: '0', postcode: '0', plaats: '0', volledig: '0'
    };
  }
}
