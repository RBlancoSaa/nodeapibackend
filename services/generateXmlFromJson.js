// 📁 /services/generateXmlFromJson.js
import fetch from 'node-fetch';

const SUPABASE_LIST_URL = (process.env.SUPABASE_LIST_PUBLIC_URL || '').replace(/\/$/, '');

function clean(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  return str !== '' ? str : '';
}
function fallback0(value) {
  const str = typeof value === 'string' ? value.trim() : '';
  return str !== '' ? str : '0';
}
function match(value, list) {
  return list.includes(value?.trim()) ? value.trim() : '';
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

export async function generateXmlFromJson(data) {
  console.log('📄 Input voor XML-generator:', JSON.stringify(data, null, 2));

  // Zet klant over naar opdrachtgever
  data.opdrachtgeverNaam = data.klantnaam;
  data.opdrachtgeverAdres = data.klantadres;
  data.opdrachtgeverPostcode = data.klantpostcode;
  data.opdrachtgeverPlaats = data.klantplaats;
  data.opdrachtgeverTelefoon = data.telefoon;
  data.opdrachtgeverEmail = data.email;
  data.opdrachtgeverBTW = data.btw;
  data.opdrachtgeverKVK = data.kvk;

  const verplichteVelden = ['opdrachtgeverNaam', 'opdrachtgeverAdres', 'opdrachtgeverPostcode', 'opdrachtgeverPlaats', 'opdrachtgeverEmail', 'opdrachtgeverBTW', 'opdrachtgeverKVK'];
  for (const veld of verplichteVelden) {
    if (!data[veld] || data[veld] === '') console.warn(`⚠️ Ontbrekend opdrachtgeverveld: ${veld}`);
  }

  const [rederijen, containers] = await Promise.all([
    fetchList('rederijen'),
    fetchList('containers')
  ]);

  const locaties = data.locaties || [];
  while (locaties.length < 3) locaties.push({ actie: '', naam: '', adres: '', postcode: '', plaats: '', land: '', voorgemeld: '', aankomst_verw: '', tijslot_van: '', tijslot_tm: '', portbase_code: '', bicsCode: '' });

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Order>
<Dossiers><Dossier>
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
  <Type>${clean(data.type)}</Type>
  <Datum>${clean(data.datum)}</Datum>
  <TijdVan>${clean(data.tijdVan)}</TijdVan>
  <TijdTM>${clean(data.tijdTM)}</TijdTM>
  <Container>${clean(data.containernummer)}</Container>
  <ContainerType>${match(data.containertype, containers)}</ContainerType>
  <Lading>${clean(data.lading)}</Lading>
  <ADR>${clean(data.adr)}</ADR>
  <Tarra>${clean(data.tarra)}</Tarra>
  <GeladenGewicht>${clean(data.geladenGewicht)}</GeladenGewicht>
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
  <Laadrefentie>${clean(data.laadreferentie)}</Laadrefentie>
  <Meldtijd>${clean(data.meldtijd)}</Meldtijd>
  <Inleverrefentie>${clean(data.inleverreferentie)}</Inleverrefentie>
  <InleverBootnaam>${clean(data.inleverBootnaam)}</InleverBootnaam>
  <InleverBestemming>${clean(data.inleverBestemming)}</InleverBestemming>
  <InleverRederij>${clean(data.inleverRederij)}</InleverRederij>
  <Inlever_TAR>${clean(data.inleverTAR)}</Inlever_TAR>
  <Closing_datum>${clean(data.closingDatum)}</Closing_datum>
  <Closing_tijd>${clean(data.closingTijd)}</Closing_tijd>
  <Instructies>${clean(data.instructies)}</Instructies>
</Container>
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
  </Locatie>`).join('\n')}
</Locaties>
<Financieel>
  <Tarief>${fallback0(data.tarief)}</Tarief>
  <BTW>${fallback0(data.btw)}</BTW>
  <ADR_toeslag_Chart>${fallback0(data.adrToeslagChart)}</ADR_toeslag_Chart>
  <ADR_bedrag_Chart>${fallback0(data.adrBedragChart)}</ADR_bedrag_Chart>
  <Botlek_Chart>${fallback0(data.botlekChart)}</Botlek_Chart>
  <Chassishuur_Bedrag_chart>${fallback0(data.chassishuurChart)}</Chassishuur_Bedrag_chart>
  <Delta_Chart>${fallback0(data.deltaChart)}</Delta_Chart>
  <Diesel_toeslag_Chart>${fallback0(data.dieselChart)}</Diesel_toeslag_Chart>
  <Euromax_Chart>${fallback0(data.euromaxChart)}</Euromax_Chart>
  <ExtraStop_Chart>${fallback0(data.extraStopChart)}</ExtraStop_Chart>
  <GasMeten_Chart>${fallback0(data.gasMetenChart)}</GasMeten_Chart>
  <Gen_Chart>${fallback0(data.genChart)}</Gen_Chart>
  <Handrail_Bedrag_chart>${fallback0(data.handrailChart)}</Handrail_Bedrag_chart>
  <Keuren_Chart>${fallback0(data.keurenChart)}</Keuren_Chart>
  <Kilometers_Chart>${fallback0(data.kilometersChart)}</Kilometers_Chart>
  <LOever_Chart>${fallback0(data.loeverChart)}</LOever_Chart>
  <Loods_Chart>${fallback0(data.loodsChart)}</Loods_Chart>
  <Maut_Chart>${fallback0(data.mautChart)}</Maut_Chart>
  <MV2_Chart>${fallback0(data.mv2Chart)}</MV2_Chart>
  <Scannen_Chart>${fallback0(data.scannenChart)}</Scannen_Chart>
  <Tol_Chart>${fallback0(data.tolChart)}</Tol_Chart>
  <Blanco1_Chart>${fallback0(data.blanco1Chart)}</Blanco1_Chart>
  <Blanco1_Text>${fallback0(data.blanco1Text)}</Blanco1_Text>
  <Blanco2_Chart>${fallback0(data.blanco2Chart)}</Blanco2_Chart>
  <Blanco2_Text>${fallback0(data.blanco2Text)}</Blanco2_Text>
</Financieel>
</Dossier></Dossiers>
</Order>`;

  console.log('📦 XML gegenereerd:', xml.slice(0, 500));
  console.log('🔍 Opdrachtgever:', data.klantnaam);
  console.log('🔍 Container:', data.containernummer);
  console.log('🔍 Terminal:', data.terminal);
  console.log('🔍 Rederij:', data.rederij);
  console.log('🔍 Laadref:', data.laadreferentie);
  console.log('🔍 Inleverref:', data.inleverreferentie);
  return xml;
}