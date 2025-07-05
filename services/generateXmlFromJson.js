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
    Jan: '01', Feb: '02', Mar: '03', Apr: '04',
    May: '05', Jun: '06', Jul: '07', Aug: '08',
    Sep: '09', Oct: '10', Nov: '11', Dec: '12'
  };
  const [dag, maandStr, jaar] = input.split(' ');
  const maand = months[maandStr] || '00';
  return `${dag.padStart(2, '0')}-${maand}-${jaar}`;
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
    throw new Error('Klantnaam ontbreekt. Bestand wordt niet gegenereerd.');
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

  const [rederijen, containers] = await Promise.all([
    fetchList('rederijen'),
    fetchList('containers')
  ]);

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
  <Opdrachtgever>${clean(data.opdrachtgeverNaam)}</Opdrachtgever>
  <Opdrachtgever_Adres>${clean(data.opdrachtgeverAdres)}</Opdrachtgever_Adres>
  <Opdrachtgever_Postcode>${clean(data.opdrachtgeverPostcode)}</Opdrachtgever_Postcode>
  <Opdrachtgever_Plaats>${clean(data.opdrachtgeverPlaats)}</Opdrachtgever_Plaats>
  <Opdrachtgever_TelefoonNummer>${clean(data.opdrachtgeverTelefoon)}</Opdrachtgever_TelefoonNummer>
  <Opdrachtgever_Email>${clean(data.opdrachtgeverEmail)}</Opdrachtgever_Email>
  <Opdrachtgever_BTW>${clean(data.opdrachtgeverBTW)}</Opdrachtgever_BTW>
  <Opdrachtgever_KVK>${clean(data.opdrachtgeverKVK)}</Opdrachtgever_KVK>
</Opdrachtgever>
<Container>
  <Ritnr>${clean(data.ritnummer)}</Ritnr>
  <Laden_Lossen>${clean(data.ladenOfLossen)}</Laden_Lossen>
  <Type></Type>
  <Datum>${clean(data.datum)}</Datum>
  <TijdVan>${clean(data.tijd)}</TijdVan>
  <TijdTM>${clean(data.tijd)}</TijdTM>
  <Container>${clean(data.containernummer)}</Container>
  <ContainerType>${clean(data.containertype)}</ContainerType>
  <Lading>${clean(data.lading)}</Lading>
  <ADR>${bevatADR(data) ? 'Waar' : 'Onwaar'}</ADR>
  <Tarra>0</Tarra>
  <GeladenGewicht>${clean(data.gewicht)}</GeladenGewicht>
  <Brutogewicht>${clean(data.brutogewicht)}</Brutogewicht>
  <Colli>${clean(data.colli)}</Colli>
  <Zegel>${clean(data.zegel)}</Zegel>
  <Temp>${clean(data.temperatuur)}</Temp>
  <CBM>${clean(data.cbm)}</CBM>
  <Brix>${clean(data.brix)}</Brix>
  <Referentie>${clean(data.referentie)}</Referentie>
  <Bootnaam>${clean(data.bootnaam)}</Bootnaam>
  <Rederij>${match(data.rederij, rederijen)}</Rederij>
  <Documentatie>${clean(data.documentatie)}</Documentatie>
  <TAR>${clean(data.tar)}</TAR>
  <Laadreferentie>${clean(data.laadreferentie)}</Laadreferentie>
  <Meldtijd>${clean(data.meldtijd)}</Meldtijd>
  <Inleverreferentie>${clean(data.inleverreferentie)}</Inleverreferentie>
  <InleverBootnaam>${clean(data.inleverBootnaam)}</InleverBootnaam>
  <InleverBestemming>${clean(data.inleverBestemming)}</InleverBestemming>
  <InleverRederij>${match(data.inleverRederij, rederijen)}</InleverRederij>
  <Inlever_TAR>${clean(data.inleverBestemming)}</Inlever_TAR>
  <Closing_datum>${clean(data.closing_datum)}</Closing_datum>
  <Closing_tijd>${clean(data.closing_tijd)}</Closing_tijd>
  <Instructies>${clean(data.instructies)}</Instructies>
</Container>

${data.adr === 'Waar' ? `
<ADR>
  <Ritnr>${clean(data.ritnummer)}</Ritnr>
  <UN>${clean(data.un)}</UN>
  <Productnaam>${clean(data.adr_productnaam)}</Productnaam>
  <Milieu>${fallbackOnwaar(data.adr_milieu)}</Milieu>
  <Afval>${fallbackOnwaar(data.adr_afval)}</Afval>
</ADR>` : ''}
<Locaties>
${locaties.map(loc => `
  <Locatie>
    <Volgorde>0</Volgorde>
    <Actie>${clean(loc.actie)}</Actie>
    <Naam>${clean(loc.naam)}</Naam>
    <Adres>${clean(loc.adres)}</Adres>
    <Postcode>${clean(loc.postcode)}</Postcode>
    <Plaats>${clean(loc.plaats)}</Plaats>
    <Land>${clean(loc.land)}</Land>
    <Voorgemeld>${clean(loc.voorgemeld)}</Voorgemeld>
    <Aankomst_verw>${clean(loc.aankomst_verw)}</Aankomst_verw>
    <Tijslot_van>${clean(loc.tijslot_van)}</Tijslot_van>
    <Tijslot_tm>${clean(loc.tijslot_tm)}</Tijslot_tm>
    <Portbase_code>${clean(loc.portbase_code)}</Portbase_code>
    <bicsCode>${clean(loc.bicsCode)}</bicsCode>
  </Locatie>
`.trim()).join('\n')}
</Locaties>
<Financieel>
  <Tarief>${fallback0(data.tarief)}</Tarief>
  <BTW>${fallback0(data.btw)}</BTW>
  <ADR_toeslag_Chart>${fallback0(data.adr_chart)}</ADR_toeslag_Chart>
  <ADR_bedrag_Chart>${fallback0(data.adr_bedrag_chart)}</ADR_bedrag_Chart>
  <Botlek_Chart>${fallback0(data.botlek_chart)}</Botlek_Chart>
  <Chassishuurb_Chart>${fallback0(data.chassishuurb_chart)}</Chassishuurb_Chart>
  <Delta_Chart>${fallback0(data.delta_chart)}</Delta_Chart>
  <Diesel_toeslag_Chart>${fallback0(data.diesel_toeslag_chart)}</Diesel_toeslag_Chart>
  <Euromax_Chart>${fallback0(data.euromax_chart)}</Euromax_Chart>
  <ExtraStop_Chart>${fallback0(data.extraStop_chart)}</ExtraStop_Chart>
  <GasMeten_Chart>${fallback0(data.gasMeten_chart)}</GasMeten_Chart>
  <Gen_Chart>${fallback0(data.gen_chart)}</Gen_Chart>
  <Handrail_Bedrag_chart>${fallback0(data.handrail_bedrag_chart)}</Handrail_Bedrag_chart>
  <Keuren_Chart>${fallback0(data.keuren_chart)}</Keuren_Chart>
  <Kilometers_Chart>${fallback0(data.kilometers_chart)}</Kilometers_Chart>
  <LOever_Chart>${fallback0(data.loever_chart)}</LOever_Chart>
  <Loods_Chart>${fallback0(data.loods_chart)}</Loods_Chart>
  <Maut_Chart>${fallback0(data.maut_chart)}</Maut_Chart>
  <MV2_Chart>${fallback0(data.mv2_chart)}</MV2_Chart>
  <Scannen_Chart>${fallback0(data.scannen_chart)}</Scannen_Chart>
  <Tol_Chart>${fallback0(data.tol_chart)}</Tol_Chart>
  <Blanco1_Chart>${fallback0(data.blanco1_chart)}</Blanco1_Chart>
  <Blanco1_Text>${fallback0(data.blanco1_text)}</Blanco1_Text>
  <Blanco2_Chart>${fallback0(data.blanco2_chart)}</Blanco2_Chart>
  <Blanco2_Text>${fallback0(data.blanco2_text)}</Blanco2_Text>
</Financieel>
</Dossier></Dossiers>
</Order>`;

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

  return xml;
}