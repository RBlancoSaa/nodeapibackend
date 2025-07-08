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
        <Type>${c(data.type)}</Type>
        <Datum>${c(data.datum)}</Datum>
        <TijdVan>${c(data.tijd)}</TijdVan>
        <TijdTM>${c(data.tijd)}</TijdTM>
        <Container>${c(data.containernummer)}</Container>
        <ContainerType>${c(data.containertype)}</ContainerType>
        <Lading>${c(data.lading)}</Lading>
        <ADR>${c(data.adr)}</ADR>
        <Tarra>${c(data.tarra)}</Tarra>
        <GeladenGewicht>${c(data.geladenGewicht)}</GeladenGewicht>
        <Brutogewicht>${c(data.brutogewicht)}</Brutogewicht>
        <Colli>${c(data.colli)}</Colli>
        <Zegel>${c(data.zegel)}</Zegel>
        <Temp>${c(data.temperatuur)}</Temp>
        <CBM>${c(data.cbm)}</CBM>
        <Brix>${c(data.brix)}</Brix>
        <Referentie>${c(data.referentie)}</Referentie>
        <Bootnaam>${c(data.bootnaam)}</Bootnaam>
        <Rederij>${c(data.rederij)}</Rederij>
        <Documentatie>${c(data.documentatie)}</Documentatie>
        <TAR>${c(data.tar)}</TAR>
        <Laadrefentie>${c(data.laadreferentie)}</Laadrefentie>
        <Meldtijd>${c(data.meldtijd)}</Meldtijd>
        <Inleverrefentie>${c(data.inleverreferentie)}</Inleverrefentie>
        <InleverBootnaam>${c(data.inleverBootnaam)}</InleverBootnaam>
        <InleverBestemming>${c(data.inleverBestemming)}</InleverBestemming>
        <InleverRederij>${c(data.inleverRederij)}</InleverRederij>
        <Inlever_TAR>${c(data.inlever_TAR)}</Inlever_TAR>
        <Closing_datum>${c(data.closing_datum)}</Closing_datum>
        <Closing_tijd>${c(data.closing_tijd)}</Closing_tijd>
        <Instructies>${c(data.instructies)}</Instructies>
      </Container>
<Locaties>
  <Locatie>
    <Volgorde>0</Volgorde>
    <Actie>${clean(locaties[0]?.actie)}</Actie>
    <Naam>${clean(locaties[0]?.naam)}</Naam>
    <Adres>${clean(locaties[0]?.adres)}</Adres>
    <Postcode>${clean(locaties[0]?.postcode)}</Postcode>
    <Plaats>${clean(locaties[0]?.plaats)}</Plaats>
    <Land>${clean(locaties[0]?.land)}</Land>
    <Voorgemeld>${clean(locaties[0]?.voorgemeld)}</Voorgemeld>
    <Aankomst_verw>${clean(locaties[0]?.aankomst_verw)}</Aankomst_verw>
    <Tijslot_van>${clean(locaties[0]?.tijslot_van)}</Tijslot_van>
    <Tijslot_tm>${clean(locaties[0]?.tijslot_tm)}</Tijslot_tm>
    <Portbase_code>${clean(locaties[0]?.portbase_code)}</Portbase_code>
    <bicsCode>${clean(locaties[0]?.bicsCode)}</bicsCode>
  </Locatie>
  <Locatie>
    <Volgorde>0</Volgorde>
    <Actie>${clean(locaties[1]?.actie)}</Actie>
    <Naam>${clean(locaties[1]?.naam)}</Naam>
    <Adres>${clean(locaties[1]?.adres)}</Adres>
    <Postcode>${clean(locaties[1]?.postcode)}</Postcode>
    <Plaats>${clean(locaties[1]?.plaats)}</Plaats>
    <Land>${clean(locaties[1]?.land)}</Land>
  </Locatie>
  <Locatie>
    <Volgorde>0</Volgorde>
    <Actie>${clean(locaties[2]?.actie)}</Actie>
    <Naam>${clean(locaties[2]?.naam)}</Naam>
    <Adres>${clean(locaties[2]?.adres)}</Adres>
    <Postcode>${clean(locaties[2]?.postcode)}</Postcode>
    <Plaats>${clean(locaties[2]?.plaats)}</Plaats>
    <Land>${clean(locaties[2]?.land)}</Land>
    <Voorgemeld>${clean(locaties[2]?.voorgemeld)}</Voorgemeld>
    <Aankomst_verw>${clean(locaties[2]?.aankomst_verw)}</Aankomst_verw>
    <Tijslot_van>${clean(locaties[2]?.tijslot_van)}</Tijslot_van>
    <Tijslot_tm>${clean(locaties[2]?.tijslot_tm)}</Tijslot_tm>
    <Portbase_code>${clean(locaties[2]?.portbase_code)}</Portbase_code>
    <bicsCode>${clean(locaties[2]?.bicsCode)}</bicsCode>
  </Locatie>
</Locaties>
<Financieel>
        <Tarief>${c(data.tarief)}</Tarief>
        <BTW>${c(data.btw)}</BTW>
        <ADR_toeslag_Chart>${c(data.adrToeslagChart)}</ADR_toeslag_Chart>
        <ADR_bedrag_Chart>${c(data.adrBedragChart)}</ADR_bedrag_Chart>
        <Botlek_Chart>${c(data.botlekChart)}</Botlek_Chart>
        <Chassishuur_Bedrag_chart>${c(data.chassishuurChart)}</Chassishuur_Bedrag_chart>
        <Delta_Chart>${c(data.deltaChart)}</Delta_Chart>
        <Diesel_toeslag_Chart>${c(data.dieselChart)}</Diesel_toeslag_Chart>
        <Euromax_Chart>${c(data.euromaxChart)}</Euromax_Chart>
        <ExtraStop_Chart>${c(data.extraStopChart)}</ExtraStop_Chart>
        <GasMeten_Chart>${c(data.gasMetenChart)}</GasMeten_Chart>
        <Gen_Chart>${c(data.genChart)}</Gen_Chart>
        <Handrail_Bedrag_chart>${c(data.handrailChart)}</Handrail_Bedrag_chart>
        <Keuren_Chart>${c(data.keurenChart)}</Keuren_Chart>
        <Kilometers_Chart>${c(data.kilometersChart)}</Kilometers_Chart>
        <LOever_Chart>${c(data.loeverChart)}</LOever_Chart>
        <Loods_Chart>${c(data.loodsChart)}</Loods_Chart>
        <Maut_Chart>${c(data.mautChart)}</Maut_Chart>
        <MV2_Chart>${c(data.mv2Chart)}</MV2_Chart>
        <Scannen_Chart>${c(data.scannenChart)}</Scannen_Chart>
        <Tol_Chart>${c(data.tolChart)}</Tol_Chart>
        <Blanco1_Chart>${c(data.blanco1Chart)}</Blanco1_Chart>
        <Blanco1_Text>${c(data.blanco1Text)}</Blanco1_Text>
        <Blanco2_Chart>${c(data.blanco2Chart)}</Blanco2_Chart>
        <Blanco2_Text>${c(data.blanco2Text)}</Blanco2_Text>
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

  return xml;
}
