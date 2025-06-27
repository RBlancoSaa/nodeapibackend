
import fetch from 'node-fetch';

const SUPABASE_LIST_URL = process.env.SUPABASE_LIST_PUBLIC_URL;

async function fetchList(name) {
  const res = await fetch(`${SUPABASE_LIST_URL}/${name}.json`);
  if (!res.ok) {
    console.error(`❌ Kan lijst niet ophalen: ${name}.json`, await res.text());
    return [];
  }
  return await res.json();
}

function safe(value) {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  return cleaned !== '' ? cleaned : '0';
}

function match(value, list) {
  return list.includes(safe(value)) ? safe(value) : '0';
}

export async function generateXmlFromJson(data) {
  const [rederijen, containers, klanten, charters, terminals] = await Promise.all([
    fetchList('rederijen'),
    fetchList('containers'),
    fetchList('klanten'),
    fetchList('charters'),
    fetchList('terminals')
  ]);

  const locaties = data.locaties || [];
  while (locaties.length < 3) {
    locaties.push({
      actie: '',
      naam: '',
      adres: '',
      postcode: '',
      plaats: '',
      land: '',
      voorgemeld: '',
      aankomst_verw: '',
      tijslot_van: '',
      tijslot_tm: '',
      portbase_code: '',
      bicsCode: ''
    });
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Order>
<Dossiers><Dossier>
<Opdrachtgever>
  <Opdrachtgever>${safe(data.opdrachtgeverNaam)}</Opdrachtgever>
  <Opdrachtgever_Adres>${safe(data.opdrachtgeverAdres)}</Opdrachtgever_Adres>
  <Opdrachtgever_Postcode>${safe(data.opdrachtgeverPostcode)}</Opdrachtgever_Postcode>
  <Opdrachtgever_Plaats>${safe(data.opdrachtgeverPlaats)}</Opdrachtgever_Plaats>
  <Opdrachtgever_TelefoonNummer>${safe(data.opdrachtgeverTelefoon)}</Opdrachtgever_TelefoonNummer>
  <Opdrachtgever_Email>${safe(data.opdrachtgeverEmail)}</Opdrachtgever_Email>
  <Opdrachtgever_BTW>${safe(data.opdrachtgeverBTW)}</Opdrachtgever_BTW>
  <Opdrachtgever_KVK>${safe(data.opdrachtgeverKVK)}</Opdrachtgever_KVK>
</Opdrachtgever>
<Container>
  <Ritnr>${safe(data.ritnummer)}</Ritnr>
  <Laden_Lossen>${safe(data.ladenOfLossen)}</Laden_Lossen>
  <Type>${safe(data.type)}</Type>
  <Datum>${safe(data.datum)}</Datum>
  <TijdVan>${safe(data.tijdVan)}</TijdVan>
  <TijdTM>${safe(data.tijdTM)}</TijdTM>
  <Container>${safe(data.containernummer)}</Container>
  <ContainerType>${match(data.containertype, containers)}</ContainerType>
  <Lading>${safe(data.lading)}</Lading>
  <ADR>${safe(data.adr)}</ADR>
  <Tarra>${safe(data.tarra)}</Tarra>
  <GeladenGewicht>${safe(data.geladenGewicht)}</GeladenGewicht>
  <Brutogewicht>${safe(data.brutogewicht)}</Brutogewicht>
  <Colli>${safe(data.colli)}</Colli>
  <Zegel>${safe(data.zegel)}</Zegel>
  <Temp>${safe(data.temperatuur)}</Temp>
  <CBM>${safe(data.cbm)}</CBM>
  <Brix>${safe(data.brix)}</Brix>
  <Referentie>${safe(data.referentie)}</Referentie>
  <Bootnaam>${safe(data.bootnaam)}</Bootnaam>
  <Rederij>${match(data.rederij, rederijen)}</Rederij>
  <Documentatie>${safe(data.documentatie)}</Documentatie>
  <TAR>${safe(data.tar)}</TAR>
  <Laadrefentie>${safe(data.laadreferentie)}</Laadrefentie>
  <Meldtijd>${safe(data.meldtijd)}</Meldtijd>
  <Inleverrefentie>${safe(data.inleverreferentie)}</Inleverrefentie>
  <InleverBootnaam>${safe(data.inleverBootnaam)}</InleverBootnaam>
  <InleverBestemming>${safe(data.inleverBestemming)}</InleverBestemming>
  <InleverRederij>${safe(data.inleverRederij)}</InleverRederij>
  <Inlever_TAR>${safe(data.inleverTAR)}</Inlever_TAR>
  <Closing_datum>${safe(data.closingDatum)}</Closing_datum>
  <Closing_tijd>${safe(data.closingTijd)}</Closing_tijd>
  <Instructies>${safe(data.instructies)}</Instructies>
</Container>
<Locaties>
  ${locaties.map(loc => `
  <Locatie>
    <Volgorde>0</Volgorde>
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
  </Locatie>`).join('\n')}
</Locaties>
<Financieel>
  <Tarief>${safe(data.tarief)}</Tarief>
  <BTW>${safe(data.btw)}</BTW>
  <ADR_toeslag_Chart>${safe(data.adrToeslagChart)}</ADR_toeslag_Chart>
  <ADR_bedrag_Chart>${safe(data.adrBedragChart)}</ADR_bedrag_Chart>
  <Botlek_Chart>${safe(data.botlekChart)}</Botlek_Chart>
  <Chassishuur_Bedrag_chart>${safe(data.chassishuurChart)}</Chassishuur_Bedrag_chart>
  <Delta_Chart>${safe(data.deltaChart)}</Delta_Chart>
  <Diesel_toeslag_Chart>${safe(data.dieselChart)}</Diesel_toeslag_Chart>
  <Euromax_Chart>${safe(data.euromaxChart)}</Euromax_Chart>
  <ExtraStop_Chart>${safe(data.extraStopChart)}</ExtraStop_Chart>
  <GasMeten_Chart>${safe(data.gasMetenChart)}</GasMeten_Chart>
  <Gen_Chart>${safe(data.genChart)}</Gen_Chart>
  <Handrail_Bedrag_chart>${safe(data.handrailChart)}</Handrail_Bedrag_chart>
  <Keuren_Chart>${safe(data.keurenChart)}</Keuren_Chart>
  <Kilometers_Chart>${safe(data.kilometersChart)}</Kilometers_Chart>
  <LOever_Chart>${safe(data.loeverChart)}</LOever_Chart>
  <Loods_Chart>${safe(data.loodsChart)}</Loods_Chart>
  <Maut_Chart>${safe(data.mautChart)}</Maut_Chart>
  <MV2_Chart>${safe(data.mv2Chart)}</MV2_Chart>
  <Scannen_Chart>${safe(data.scannenChart)}</Scannen_Chart>
  <Tol_Chart>${safe(data.tolChart)}</Tol_Chart>
  <Blanco1_Chart>${safe(data.blanco1Chart)}</Blanco1_Chart>
  <Blanco1_Text>${safe(data.blanco1Text)}</Blanco1_Text>
  <Blanco2_Chart>${safe(data.blanco2Chart)}</Blanco2_Chart>
  <Blanco2_Text>${safe(data.blanco2Text)}</Blanco2_Text>
</Financieel>
</Dossier></Dossiers>
</Order>`;
}
