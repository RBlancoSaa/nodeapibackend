// nodeapibackend/services/generateXmlFromJson.js

import fetch from 'node-fetch';

const SUPABASE_LIST_URL = process.env.SUPABASE_LIST_PUBLIC_URL;

async function fetchList(name) {
  const res = await fetch(`${SUPABASE_LIST_URL}${name}.json`);
  if (!res.ok) return [];
  return await res.json();
}

function safe(value) {
  return value ? String(value).trim() : '';
}

function match(value, list) {
  return list.includes(safe(value)) ? safe(value) : '';
}

export async function generateXmlFromJson(data) {
  const [rederijen, containers, klanten, charters, terminals] = await Promise.all([
    fetchList('rederijen'),
    fetchList('containers'),
    fetchList('klanten'),
    fetchList('charters'),
    fetchList('terminals')
  ]);

  const klantreferentie = safe(data.klantreferentie);
  const containernummer = safe(data.containernummer);
  const containertype = match(data.containertype, containers);
  const rederij = match(data.rederij, rederijen);
  const bootnaam = safe(data.bootnaam);
  const opmerking = safe(data.remark);

  const locatie1 = {
    actie: 'Opzetten',
    naam: safe(data.uithaalplaats),
    adres: safe(data.uithaaladres),
    postcode: safe(data.uithaalpostcode),
    plaats: safe(data.uithaalplaats)
  };

  const locatie2 = {
    actie: 'Laden',
    naam: match(data.klantnaam, klanten.concat(charters)),
    adres: safe(data.laadadres),
    postcode: safe(data.laadpostcode),
    plaats: safe(data.laadplaats)
  };

  const locatie3 = {
    actie: 'Inleveren',
    naam: match(data.inleverplaats, terminals),
    adres: safe(data.inleveradres),
    postcode: safe(data.inleverpostcode),
    plaats: safe(data.inleverplaats)
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<Easytrip>
  <Container>
    <Nummer>${containernummer}</Nummer>
    <Type>${containertype}</Type>
    <Rederij>${rederij}</Rederij>
    <Bootnaam>${bootnaam}</Bootnaam>
    <Opmerking>${opmerking}</Opmerking>
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
      <Actie>${locatie1.actie}</Actie>
      <Naam>${locatie1.naam}</Naam>
      <Adres>${locatie1.adres}</Adres>
      <Postcode>${locatie1.postcode}</Postcode>
      <Plaats>${locatie1.plaats}</Plaats>
    </Locatie>
    <Locatie>
      <Volgorde>1</Volgorde>
      <Actie>${locatie2.actie}</Actie>
      <Naam>${locatie2.naam}</Naam>
      <Adres>${locatie2.adres}</Adres>
      <Postcode>${locatie2.postcode}</Postcode>
      <Plaats>${locatie2.plaats}</Plaats>
    </Locatie>
    <Locatie>
      <Volgorde>2</Volgorde>
      <Actie>${locatie3.actie}</Actie>
      <Naam>${locatie3.naam}</Naam>
      <Adres>${locatie3.adres}</Adres>
      <Postcode>${locatie3.postcode}</Postcode>
      <Plaats>${locatie3.plaats}</Plaats>
    </Locatie>
  </Locaties>
  <Financieel>
    <Betaalwijze>Geen</Betaalwijze>
    <Douane>0</Douane>
    <Overnachting>0</Overnachting>
    <Wachttijd>0</Wachttijd>
    <ExtraKosten>0</ExtraKosten>
  </Financieel>
</Easytrip>`;
} 
