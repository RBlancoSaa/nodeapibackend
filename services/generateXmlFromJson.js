// 📁 /services/generateXmlFromJson.js
import '../utils/fsPatch.js'; // ✅ Eerst patchen!
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const SUPABASE_LIST_URL = (process.env.SUPABASE_LIST_PUBLIC_URL || '').replace(/\/$/, '');

function clean(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '0') return '';
  if (value === 0 || value === '0') return '';
  const val = value.toString();
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
// korte alias, zodat alle bestaande c(...) calls werken
const c = clean;

function fallback0(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  return str !== '' ? str : '0';
}
function match(value, list) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  return list.includes(cleaned) ? cleaned : '';
}
function fallbackOnwaar(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  return str !== '' ? str : 'Onwaar';
}

function bevatADR(data) {
  const ladingTekst = `${data.lading || ''}`.toUpperCase();
  const imoTekst = `${data.imo || ''}`.toUpperCase();
  return (
    ladingTekst.includes('ADR') ||
    /UN\d{4}/.test(ladingTekst) ||
    (imoTekst && imoTekst !== '0')
  );
}

function normalizeContainerOmschrijving(str) {
  return (str || '')
    .toLowerCase()
    .replace(/^(\d+)\s*x\s*/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

// 📆 Datum fix voor EasyTrip
function formatDatumVoorEasyTrip(input) {
  if (!input || input.includes('-')) return input; // ✅ voorkomt dubbele conversie
  const months = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4,
    May: 5, Jun: 6, Jul: 7, Aug: 8,
    Sep: 9, Oct: 10, Nov: 11, Dec: 12
  };
  const [dag, maandStr, jaar] = input.split(' ');
  const maand = months[maandStr] || 0;
  return `${parseInt(dag)}-${maand}-${jaar}`;
}
async function fetchList(name) {
  const url = `${SUPABASE_LIST_URL}/${name}.json`;
  console.log(`🌍 Ophalen lijst: ${url}`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`❌ ${name}.json: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`💥 Fout bij lijst "${name}":`, err.message);
    throw err;
  }
}

function getContainerCodeFromOmschrijving(omschrijving, containerList) {
  const norm = normalizeContainerOmschrijving(omschrijving);
  for (const item of containerList) {
    const opties = [item.label, ...(item.altLabels || [])].map(normalizeContainerOmschrijving);
    if (opties.includes(norm)) return item.code;
  }
  return null; // ✅ HIER NOG TOEVOEGEN!
}

export async function generateXmlFromJson(data) {
  if (!data.containertype || data.containertype === '0') {
    throw new Error('Containertype ontbreekt. Bestand wordt niet gegenereerd.');
  }
  if (!data.datum) {
    throw new Error('Datum ontbreekt. Bestand wordt niet gegenereerd.');
  }
 if (!data.klantnaam) {
  console.warn('⚠️ Klantnaam ontbreekt – bestand wordt wel gegenereerd');
}

  console.log('📄 Input voor XML-generator:', JSON.stringify(data, null, 2));

  data.zegel = data.zegel || '';
  data.documentatie = data.documentatie || '';
  data.tar = data.tar || '';
  data.type = ''; // EasyTrip gebruikt 'Type' alleen bij specialisatie, niet bij containers
  data.datum = formatDatumVoorEasyTrip(data.datum); // 👈 HIER PLAATSEN
  data.closing_datum = data.closing_datum || '';
  data.closing_tijd = data.closing_tijd || '';

  const verplichteVelden = ['opdrachtgeverNaam', 'opdrachtgeverAdres', 'opdrachtgeverPostcode', 'opdrachtgeverPlaats', 'opdrachtgeverEmail', 'opdrachtgeverBTW', 'opdrachtgeverKVK'];
  for (const veld of verplichteVelden) {
    if (!data[veld] || data[veld] === '') console.warn(`⚠️ Ontbrekend opdrachtgeverveld: ${veld}`);
  }
  const zeroFallback = (val) => (val === undefined || val === '' || val === null ? '0' : val);
  const [rederijen, containers] = await Promise.all([
    fetchList('rederijen'),
    fetchList('containers')
  ]);
  // 🧊 Temperatuur strippen
  const cleanTemperature = (val) => {
  if (!val || typeof val !== 'string') return zeroFallback(val);
  const match = val.match(/-?\d+(\.\d+)?/); // haalt bijv. "-18°C" ➜ "-18"
  return match ? match[0] : '0';
  };

  const locaties = data.locaties || [];
  while (locaties.length < 3) locaties.push({
    actie: '', naam: '', adres: '', postcode: '', plaats: '', land: '',
    voorgemeld: '', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
    portbase_code: '', bicsCode: ''
  });

// 📌 Match containertype-omschrijving → code uit containerslijst
const code = getContainerCodeFromOmschrijving(data.containertype, containers);
if (!code) {
  throw new Error('❌ Geen geldig containertype gevonden op basis van omschrijving.');
}
data.containertype = code;

// ✅ Minimale vereisten check – verplaatst naar ná code-matching
if (!data.containertype || data.containertype === '0') {
  throw new Error('❌ Geen geldig containertype gevonden op basis van omschrijving.');
}

if (!data.actie || data.actie === '0') {
  const acties = (data.locaties || []).map(loc => loc.actie?.toLowerCase());
  if (acties.includes('lossen')) data.actie = 'Lossen';
  else data.actie = 'Laden';
}

  console.log('📄 Start XML-generatie');
const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Order>
<Dossiers>
<Dossier>
<Opdrachtgever>
<Opdrachtgever>${c(data.opdrachtgeverNaam)}</Opdrachtgever>
<Opdrachtgever_Adres>${c(data.opdrachtgeverAdres)}</Opdrachtgever_Adres>
<Opdrachtgever_Postcode>${c(data.opdrachtgeverPostcode)}</Opdrachtgever_Postcode>
<Opdrachtgever_Plaats>${c(data.opdrachtgeverPlaats)}</Opdrachtgever_Plaats>
<Opdrachtgever_TelefoonNummer>${c(data.opdrachtgeverTelefoon)}</Opdrachtgever_TelefoonNummer>
<Opdrachtgever_Email>${c(data.opdrachtgeverEmail)}</Opdrachtgever_Email>
<Opdrachtgever_BTW>${c(data.opdrachtgeverBTW)}</Opdrachtgever_BTW>
<Opdrachtgever_KVK>${c(data.opdrachtgeverKVK)}</Opdrachtgever_KVK>
</Opdrachtgever>
<Container>
<Ritnr>${c(data.ritnummer)}</Ritnr>
<Laden_Lossen>${c(data.ladenOfLossen)}</Laden_Lossen>
<Type></Type>
<Datum>${c(data.datum)}</Datum>
<TijdVan>${c(data.tijd)}</TijdVan>
<TijdTM></TijdTM>
<Container>${c(data.containernummer)}</Container>
<ContainerType>${c(data.containertype)}</ContainerType>
<Lading>${c(data.lading)}</Lading>
<ADR>${c(data.adr)}</ADR>
<Tarra>${zeroFallback(data.tarra)}</Tarra>
<GeladenGewicht>${zeroFallback(data.geladenGewicht)}</GeladenGewicht>
<Brutogewicht>${zeroFallback(data.brutogewicht)}</Brutogewicht>
<Colli>${zeroFallback(data.colli)}</Colli>
<Zegel>${c(data.zegel)}</Zegel>
<Temp>${cleanTemperature(data.temperatuur)}</Temp>
<CBM>${zeroFallback(data.cbm)}</CBM>
<Brix>${zeroFallback(data.brix)}</Brix>
<Referentie>${c(data.referentie)}</Referentie>
<Bootnaam>${c(data.bootnaam)}</Bootnaam>
<Rederij>${c(data.rederij)}</Rederij>
<Documentatie>${c(data.documentatie)}</Documentatie>
<TAR>${c(data.tar)}</TAR>
<Laadrefentie>${c(data.laadreferentie)}</Laadrefentie>
<Meldtijd></Meldtijd>
<Inleverrefentie>${c(data.inleverreferentie)}</Inleverrefentie>
<InleverBootnaam>${c(data.inleverBootnaam)}</InleverBootnaam>
<InleverBestemming>${c(data.inleverBestemming)}</InleverBestemming>
<InleverRederij>${c(data.inleverRederij)}</InleverRederij>
<Inlever_TAR></Inlever_TAR>
<Closing_datum></Closing_datum>
<Closing_tijd></Closing_tijd>
<Instructies>${c(data.instructies)}</Instructies>
</Container>
<Locaties>
<Locatie>
<Volgorde>0</Volgorde>
<Actie>Opzetten</Actie>
<Naam>${c(data.locaties[0].naam)}</Naam>
<Adres>${c(data.locaties[0].adres)}</Adres>
<Postcode>${c(data.locaties[0].postcode)}</Postcode>
<Plaats>${c(data.locaties[0].plaats)}</Plaats>
<Land>${c(data.locaties[0].land)}</Land>
<Voorgemeld>Onwaar</Voorgemeld>
<Aankomst_verw></Aankomst_verw>
<Tijslot_van></Tijslot_van>
<Tijslot_tm></Tijslot_tm>
<Portbase_code>${c(data.locaties[0].portbase_code)}</Portbase_code>
<bicsCode>${c(data.locaties[0].bicsCode)}</bicsCode>
</Locatie>
<Locatie>
<Volgorde>0</Volgorde>
<Actie>${c(data.locaties[1].actie)}</Actie>
<Naam>${c(data.locaties[1].naam)}</Naam>
<Adres>${c(data.locaties[1].adres)}</Adres>
<Postcode>${c(data.locaties[1].postcode)}</Postcode>
<Plaats>${c(data.locaties[1].plaats)}</Plaats>
<Land>${c(data.locaties[1].land)}</Land>
</Locatie>
<Locatie>
<Volgorde>0</Volgorde>
<Actie>Afzetten</Actie>
<Naam>${c(data.locaties[2].naam)}</Naam>
<Adres>${c(data.locaties[2].adres)}</Adres>
<Postcode>${c(data.locaties[2].postcode)}</Postcode>
<Plaats>${c(data.locaties[2].plaats)}</Plaats>
<Land>${c(data.locaties[2].land)}</Land>
<Voorgemeld>Onwaar</Voorgemeld>
<Aankomst_verw></Aankomst_verw>
<Tijslot_van></Tijslot_van>
<Tijslot_tm></Tijslot_tm>
<Portbase_code>${c(data.locaties[2].portbase_code)}</Portbase_code>
<bicsCode>${c(data.locaties[2].bicsCode)}</bicsCode>
</Locatie>
</Locaties>
<Financieel>
<Tarief>0</Tarief>
<BTW>0</BTW>
<ADR_toeslag_Chart>0</ADR_toeslag_Chart>
<ADR_bedrag_Chart>0</ADR_bedrag_Chart>
<Botlek_Chart>0</Botlek_Chart>
<Chassishuur_Bedrag_chart>0</Chassishuur_Bedrag_chart>
<Delta_Chart>0</Delta_Chart>
<Diesel_toeslag_Chart>0</Diesel_toeslag_Chart>
<Euromax_Chart>0</Euromax_Chart>
<ExtraStop_Chart>0</ExtraStop_Chart>
<GasMeten_Chart>0</GasMeten_Chart>
<Gen_Chart>0</Gen_Chart>
<Handrail_Bedrag_chart>0</Handrail_Bedrag_chart>
<Keuren_Chart>0</Keuren_Chart>
<Kilometers_Chart>0</Kilometers_Chart>
<LOever_Chart>0</LOever_Chart>
<Loods_Chart>0</Loods_Chart>
<Maut_Chart>0</Maut_Chart>
<MV2_Chart>0</MV2_Chart>
<Scannen_Chart>0</Scannen_Chart>
<Tol_Chart>0</Tol_Chart>
<Blanco1_Chart>0</Blanco1_Chart>
<Blanco1_Text></Blanco1_Text>
<Blanco2_Chart>0</Blanco2_Chart>
<Blanco2_Text></Blanco2_Text>
</Financieel>
</Dossier>
</Dossiers>
</Order>`;
  // ✅ Log de eerste 600 tekens van de XML

  console.log('📦 XML gegenereerd:', xml.slice(0, 600));
  console.log('🔍 Opdrachtgever:', data.klantnaam);
  console.log('🔍 Container:', data.containernummer);
  console.log('🔍 Terminal:', data.terminal);
  console.log('🔍 Rederij:', data.rederij);
  console.log('🔍 Laadref:', data.laadreferentie);
  console.log('🔍 Inleverref:', data.inleverreferentie);
  console.log('🔎 Actie:', data.actie);
  console.log('🔎 Zegel:', data.zegel);
  console.log('🔎 Type:', data.type);
  console.log('🔎 Documentatie:', data.documentatie);
  console.log('🧪 ADR check:', {
  adr: data.adr,
  imo: data.imo,
  lading: data.lading,
  adrStatus: bevatADR(data) ? 'Waar' : 'Onwaar'
});

  const windowsXml = xml.replace(/\n/g, '\r\n'); // converteert naar CRLF
  return windowsXml;
}
