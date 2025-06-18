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

  return `<?xml version="1.0" encoding="UTF-8"?>
<Easytrip>
  <Opdrachtgever>
    <Opdrachtgever_Naam>${safe(data.opdrachtgever_naam)}</Opdrachtgever_Naam>
    <Opdrachtgever_Adres>${safe(data.opdrachtgever_adres)}</Opdrachtgever_Adres>
    <Opdrachtgever_Postcode>${safe(data.opdrachtgever_postcode)}</Opdrachtgever_Postcode>
    <Opdrachtgever_Plaats>${safe(data.opdrachtgever_plaats)}</Opdrachtgever_Plaats>
  </Opdrachtgever>

  <Container>
    <Nummer>${safe(data.containernummer)}</Nummer>
    <Type>${match(data.containertype, containers)}</Type>
    <Rederij>${match(data.rederij, rederijen)}</Rederij>
    <Bootnaam>${safe(data.bootnaam)}</Bootnaam>
    <Opmerking>${safe(data.remark)}</Opmerking>
  </Container>

  <ADR>
    <UNNR>${safe(data.unnumber)}</UNNR>
    <Temperatuur>${safe(data.temperatuur)}</Temperatuur>
    <Volume>${safe(data.volume)}</Volume>
    <Gewicht>${safe(data.gewicht)}</Gewicht>
  </ADR>

  <Locaties>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Opzetten</Actie>
      <Naam>${safe(data.uithaalplaats)}</Naam>
      <Adres>${safe(data.uithaaladres)}</Adres>
      <Postcode>${safe(data.uithaalpostcode)}</Postcode>
      <Plaats>${safe(data.uithaalplaats)}</Plaats>
    </Locatie>
    <Locatie>
      <Volgorde>1</Volgorde>
      <Actie>Laden</Actie>
      <Naam>${match(data.klantnaam, klanten.concat(charters))}</Naam>
      <Adres>${safe(data.laadadres)}</Adres>
      <Postcode>${safe(data.laadpostcode)}</Postcode>
      <Plaats>${safe(data.laadplaats)}</Plaats>
    </Locatie>
    <Locatie>
      <Volgorde>2</Volgorde>
      <Actie>Inleveren</Actie>
      <Naam>${match(data.inleverplaats, terminals)}</Naam>
      <Adres>${safe(data.inleveradres)}</Adres>
      <Postcode>${safe(data.inleverpostcode)}</Postcode>
      <Plaats>${safe(data.inleverplaats)}</Plaats>
    </Locatie>
  </Locaties>

  <Financieel>
    <Betalwijze>${safe(data.betalingswijze)}</Betalwijze>
    <Douane>0</Douane>
    <Overnachting>0</Overnachting>
    <Wachttijd>0</Wachttijd>
    <ExtraKosten>0</ExtraKosten>
  </Financieel>

  <Dossiers>
    <Dossier>${safe(data.klantreferentie)}</Dossier>
  </Dossiers>
</Easytrip>`;
}
