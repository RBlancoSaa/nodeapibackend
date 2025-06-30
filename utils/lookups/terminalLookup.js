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
  const bestandspad = path.resolve('data/klanten.json'); // of het juiste pad
  const json = JSON.parse(fs.readFileSync(bestandspad, 'utf-8'));

  const klant = json.find(item => {
    return item.Bedrijfsnaam?.toLowerCase().trim() === klantAlias.toLowerCase().trim();
  });

  if (!klant) {
    console.warn(`⚠️ Geen klant gevonden voor alias: ${klantAlias}`);
    return {};
  }

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
