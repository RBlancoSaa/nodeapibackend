// utils/lookups/terminalLookup.js
import '../../utils/fsPatch.js';
import fetch from 'node-fetch';

const SUPABASE_LIST_URL = process.env.SUPABASE_LIST_PUBLIC_URL?.replace(/\/$/, '');

export async function getTerminalInfo(referentie) {
  try {
    if (!referentie || typeof referentie !== 'string') return null;

    const url = `${SUPABASE_LIST_URL}/op_afzetten.json`;
    const response = await fetch(url);
    const lijst = await response.json();

    const gevonden = lijst.find(item => item.referentie?.toLowerCase() === referentie.toLowerCase());
    if (!gevonden) return null;

    return gevonden.terminal || '0';
  } catch (err) {
    console.error('❌ Fout in getTerminalInfo:', err);
    return null;
  }
}

export async function getRederijNaam(rederij) {
  try {
    if (!rederij || typeof rederij !== 'string') return null;

    const url = `${SUPABASE_LIST_URL}/rederijen.json`;
    const response = await fetch(url);
    const lijst = await response.json();

    const gevonden = lijst.find(item => item.naam?.toLowerCase() === rederij.toLowerCase());
    if (!gevonden) return null;

    return gevonden.code || '0';
  } catch (err) {
    console.error('❌ Fout in getRederijNaam:', err);
    return null;
  }
}

export async function getContainerTypeCode(type) {
  try {
    if (!type || typeof type !== 'string') return null;

    const url = `${SUPABASE_LIST_URL}/containers.json`;
    const response = await fetch(url);
    const lijst = await response.json();

    const gevonden = lijst.find(item => item.naam?.toLowerCase() === type.toLowerCase());
    if (!gevonden) return null;

    return gevonden.code || '0';
  } catch (err) {
    console.error('❌ Fout in getContainerTypeCode:', err);
    return null;
  }
}

export async function getKlantData(klantnaam) {
  try {
    if (!klantnaam || typeof klantnaam !== 'string') return null;

    const url = `${SUPABASE_LIST_URL}/klanten.json`;
    const response = await fetch(url);
    const lijst = await response.json();

    const gevonden = lijst.find(item => item.naam?.toLowerCase() === klantnaam.toLowerCase());
    if (!gevonden) return null;

    return {
      adres: gevonden.adres || '0',
      postcode: gevonden.postcode || '0',
      plaats: gevonden.plaats || '0',
      volledig: gevonden.volledig || '0'
    };
  } catch (err) {
    console.error('❌ Fout in getKlantData:', err);
    return null;
  }
}
