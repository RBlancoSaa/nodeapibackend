// nodeapibackend/services/generateXmlFromJson.js

import fetch from 'node-fetch';

const SUPABASE_LIST_URL = process.env.SUPABASE_LIST_PUBLIC_URL;

function safe(value) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  return cleaned !== '' ? cleaned : '0';
}

function match(value, list) {
  return list.includes(safe(value)) ? safe(value) : '0';
}

async function fetchList(name) {
  const res = await fetch(`${SUPABASE_LIST_URL}/${name}.json`);
  if (!res.ok) return [];
  return await res.json();
}

export async function generateXmlFromJson(data) {
  const [rederijen, containers, klanten, charters, terminals] = await Promise.all([
    fetchList('rederijen'),
    fetchList('containers'),
    fetchList('klanten'),
    fetchList('charters'),
    fetchList('terminals')
  ]);

  const locatiesXml = (data.locaties || []).map(loc => `
  <Locatie>
    <Volgorde>${safe(loc.volgorde)}</Volgorde>
    <Actie>${safe(loc.actie)}</Actie>
    <Naam>${safe(loc.naam)}</Naam>
    <Adres>${safe(loc.adres)}</Adres>
    <Postcode>${safe(loc.postcode)}</Postcode>
    <Plaats>${safe(loc.plaats)}</Plaats>
    <Land>${safe(loc.land)}</Land>
    <Voorgemeld>${safe(loc.voorgemeld)}</Voorgemeld>
    <Aankomst_verw>${safe(loc.aankomst_verw)}</Aankomst_verw>
    <Tijslot_van>${safe(loc.tijslot_van)}</Tijslot_van>
    <Tijslot_tm>${safe(loc.tijslot_tm)}</Tijslot_tm>
    <Portbase_code>${safe(loc.portbase_code)}</Portbase_code>
    <bicsCode>${safe(loc.bicsCode)}</bicsCode>
  </Locatie>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Order>
<Dossiers><Dossier>
<Opdrachtgever>
  <Opdrachtgever>${safe(data.opdrachtgever)}</Opdrachtgever>
  <Opdrachtgever_Adres>${safe(data.opdrachtgever_adres)}</Opdrachtgever_Adres>
  <Opdrachtgever_Postcode>${safe(data.opdrachtgever_postcode)}</Opdrachtgever_Postcode>
  <Opdrachtgever_Plaats>${safe(data.opdrachtgever_plaats)}</Opdrachtgever_Plaats>
  <Opdrachtgever_TelefoonNummer>${safe(data.opdrachtgever_telefoon)}</Opdrachtgever_TelefoonNummer>
  <Opdrachtgever_Email>${safe(data.opdrachtgever_email)}</Opdrachtgever_Email>
  <Opdrachtgever_BTW>${safe(data.opdrachtgever_btw)}</Opdrachtgever_BTW>
  <Opdrachtgever_KVK>${safe(data.opdrachtgever_kvk)}</Opdrachtgever_KVK>
</Opdrachtgever>
<Container>
  <Ritnr>${safe(data.ritnr)}</Ritnr>
  <Laden_Lossen>${safe(data.laden_lossen)}</Laden_Lossen>
  <Type>${safe(data.type)}</Type>
  <Datum>${safe(data.datum)}</Datum>
  <TijdVan>${safe(data.tijd_van)}</TijdVan>
  <TijdTM>${safe(data.tijd_tm)}</TijdTM>
  <Container>${safe(data.containernummer)}</Container>
  <ContainerType>${match(data.containertype, containers)}</ContainerType>
  <Lading>${safe(data.lading)}</Lading>
  <ADR>${safe(data.adr)}</ADR>
  <Tarra>${safe(data.tarra)}</Tarra>
  <GeladenGewicht>${safe(data.geladen_gewicht)}</GeladenGewicht>
  <Brutogewicht>${safe(data.bruto_gewicht)}</Brutogewicht>
  <Colli>${safe(data.colli)}</Colli>
  <Zegel>${safe(data.zegel)}</Zegel>
  <Temp>${safe(data.temperatuur)}</Temp>
  <CBM>${safe(data.cbm)}</CBM>
  <Brix>${safe(data.brix)}</Brix>
  <Referentie>${safe(data.klantreferentie)}</Referentie>
  <Bootnaam>${safe(data.bootnaam)}</Bootnaam>
  <Rederij>${match(data.rederij, rederijen)}</Rederij>
  <Documentatie>${safe(data.documentatie)}</Documentatie>
  <TAR>${safe(data.tar)}</TAR>
  <Laadreferentie>${safe(data.laadreferentie)}</Laadreferentie>
  <Meldtijd>${safe(data.meldtijd)}</Meldtijd>
  <Inleverrefentie>${safe(data.inleverreferentie)}</Inleverrefentie>
  <InleverBootnaam>${safe(data.inleverbootnaam)}</InleverBootnaam>
  <InleverBestemming>${safe(data.inleverbestemming)}</InleverBestemming>
  <InleverRederij>${safe(data.inleverrederij)}</InleverRederij>
  <Inlever_TAR>${safe(data.inlever_tar)}</Inlever_TAR>
  <Closing_datum>${safe(data.closing_datum)}</Closing_datum>
  <Closing_tijd>${safe(data.closing_tijd)}</Closing_tijd>
  <Instructies>${safe(data.instructies)}</Instructies>
</Container>
<Locaties>
${locatiesXml}
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
</Dossier></Dossiers>
</Order>`;
}
