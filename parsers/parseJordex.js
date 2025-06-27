import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function parseJordex(pdfBuffer) {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text;

    const rawDropoffTerminal = (text.match(/Drop-off terminal\s+Address:\s*(.*)/i) || [])[1] || '';
    const rawPickupTerminal = (text.match(/Pick-up terminal\s+Address:\s*(.*)/i) || [])[1] || '';
    const rawContainertype = (text.match(/(\d{2})['’]?\s+high\s+cube\s+reefer/i) || [])[0] || '';
    const rawRederij = (text.match(/Carrier:\s*(.*)/i) || [])[1] || '';
    const rawInleverBestemming = (text.match(/To:\s*(.*)/i) || [])[1] || '';

    const opdrachtgeverNaam = (text.match(/Opdrachtgever:\s*(.*)/i) || [])[1] || '';
    const opdrachtgeverAdres = (text.match(/Adres:\s*(.*)/i) || [])[1] || '';
    const opdrachtgeverPostcode = (text.match(/Postcode:\s*(\d{4}\s?[A-Z]{2})/i) || [])[1] || '';
    const opdrachtgeverPlaats = (text.match(/Plaats:\s*(.*)/i) || [])[1] || '';
    const opdrachtgeverTelefoon = (text.match(/Tel(?:ef)?(?:oonnummer)?:\s*([\d\-+() ]{6,})/i) || [])[1] || '';
    const opdrachtgeverEmail = (text.match(/E-?mail:\s*([\w.-]+@[\w.-]+\.\w+)/i) || [])[1] || '';
    const opdrachtgeverBTW = (text.match(/BTW(?:-nummer)?:\s*([\w\d.-]+)/i) || [])[1] || '';
    const opdrachtgeverKVK = (text.match(/K\.?v\.?K\.?:?\s*(\d{8})/i) || [])[1] || '';

    const referentie = (text.match(/Our reference:\s*(\S+)/i) || [])[1] || '';
    const lading = (text.match(/Description\s*\n(.*)/i) || [])[1] || 'FROZEN PORK';
    const temperatuur = (text.match(/Temperature:\s*(-?\d+)[°º]C/i) || [])[1] || '';
    const cbm = (text.match(/(\d{2,5})m³/i) || [])[1] || '';
    const gewicht = (text.match(/(\d{2,5})\s?kg/i) || [])[1] || '';
    const colli = (text.match(/Colli\s*(\d+)/i) || [])[1] || '';
    const bootnaam = (text.match(/Vessel:\s*(.*)/i) || [])[1] || '';
    const closingDatum = (text.match(/Document closing:\s*(\d{2}\s\w{3}\s\d{4})/i) || [])[1] || '';
    const closingTijd = (text.match(/Document closing:\s*\d{2}\s\w{3}\s\d{4}\s+(\d{2}:\d{2})/i) || [])[1] || '';
    const laadreferentie = (text.match(/Pick-up[\s\S]*?Reference\(s\):\s*(\d+)/i) || [])[1] || '';
    const inleverreferentie = (text.match(/Drop-off terminal[\s\S]*?Reference\(s\):\s*(\d+)/i) || [])[1] || '';

    const [{ data: dropoffMatch }, { data: pickupMatch }, { data: containertypeMatch }, { data: rederijMatch }, { data: bestemmingMatch }] = await Promise.all([
      supabase.from('terminals').select('*').eq('naam', rawDropoffTerminal).maybeSingle(),
      supabase.from('terminals').select('*').eq('naam', rawPickupTerminal).maybeSingle(),
      supabase.from('containertypes').select('naam').eq('naam', rawContainertype).maybeSingle(),
      supabase.from('rederijen').select('naam').eq('naam', rawRederij).maybeSingle(),
      supabase.from('inleverlocaties').select('naam').eq('naam', rawInleverBestemming).maybeSingle(),
    ]);

    if (!dropoffMatch) console.warn('⚠️ Geen match voor drop-off terminal:', rawDropoffTerminal);
    if (!pickupMatch) console.warn('⚠️ Geen match voor pick-up terminal:', rawPickupTerminal);
    if (!containertypeMatch) console.warn('⚠️ Geen match voor containertype:', rawContainertype);
    if (!rederijMatch) console.warn('⚠️ Geen match voor rederij:', rawRederij);
    if (!bestemmingMatch) console.warn('⚠️ Geen match voor inleverbestemming:', rawInleverBestemming);

    return {
      opdrachtgeverNaam,
      opdrachtgeverAdres,
      opdrachtgeverPostcode,
      opdrachtgeverPlaats,
      opdrachtgeverTelefoon,
      opdrachtgeverEmail,
      opdrachtgeverBTW,
      opdrachtgeverKVK,
      referentie,
      lading,
      temperatuur,
      cbm,
      gewicht,
      colli,
      bootnaam,
      closingDatum,
      closingTijd,
      laadreferentie,
      inleverreferentie,
      dropoffMatch,
      pickupMatch,
      containertype: containertypeMatch?.naam || '',
      rederij: rederijMatch?.naam || '',
      inleverBestemming: bestemmingMatch?.naam || '',
      text
    };
  } catch (err) {
    console.error('❌ Fout in parseJordex:', err.message);
    throw err;
  }
}
