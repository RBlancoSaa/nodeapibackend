// nodeapibackend/services/generateXmlFromJson.js

export function generateXmlFromJson(data) {
  const {
    klantreferentie = 'Onbekend',
    containernummer = 'XXXX1234567',
    containertype = '45G1',
    rederij = 'MSC',
    bootnaam = 'Default Vessel',
    uithaaladres = 'Uithaaladres onbekend',
    uithaalpostcode = '0000AA',
    uithaalplaats = 'Onbekend',
    uithaalreferentie = 'UITHAAL123',
    laadadres = 'Laadadres onbekend',
    laadpostcode = '0000BB',
    laadplaats = 'Onbekend',
    laadref = 'LAADREF123',
    inleveradres = 'Inleveradres onbekend',
    inleverpostcode = '0000CC',
    inleverplaats = 'Onbekend',
    inleverreferentie = 'INLEVER123',
    gewicht = '34000',
    temperatuur = '',
    unnumber = '',
    volume = '',
    remark = ''
  } = data;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Easytrip>
  <Container>
    <Nummer>${containernummer}</Nummer>
    <Type>${containertype}</Type>
    <Rederij>${rederij}</Rederij>
    <Bootnaam>${bootnaam}</Bootnaam>
    <Opmerking>${remark}</Opmerking>
  </Container>
  <ADR>
    <UNNR>${unnumber}</UNNR>
    <Temperatuur>${temperatuur}</Temperatuur>
    <Volume>${volume}</Volume>
    <Gewicht>${gewicht}</Gewicht>
  </ADR>
  <Locaties>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Opzetten</Actie>
      <Naam>uithaaladres</Naam>
      <Adres>${uithaaladres}</Adres>
      <Postcode>${uithaalpostcode}</Postcode>
      <Plaats>${uithaalplaats}</Plaats>
    </Locatie>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Laden</Actie>
      <Naam>klant</Naam>
      <Adres>${laadadres}</Adres>
      <Postcode>${laadpostcode}</Postcode>
      <Plaats>${laadplaats}</Plaats>
      <Referentie>${laadref}</Referentie>
    </Locatie>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Inleveren</Actie>
      <Naam>terminal</Naam>
      <Adres>${inleveradres}</Adres>
      <Postcode>${inleverpostcode}</Postcode>
      <Plaats>${inleverplaats}</Plaats>
      <Referentie>${inleverreferentie}</Referentie>
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