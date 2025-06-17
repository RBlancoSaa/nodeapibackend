export function generateEasyXML(pdfData) {
  if (!pdfData || typeof pdfData !== 'object') {
    console.error("❌ Ongeldige pdfData in generateEasyXML");
    return '';
  }

  // 🔧 Voorbeelddata ophalen uit pdfData
  const {
    klantreferentie,
    containernummer,
    containertype,
    rederij,
    bootnaam,
    laadadres,
    laadpostcode,
    laadplaats,
    laadreferentie,
    inleveradres,
    inleverpostcode,
    inleverplaats,
    inleverreferentie,
    imo,
    gewicht,
    temperatuur,
    volume
  } = pdfData;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Transport>
  <Container>
    <ContainerNummer>${containernummer}</ContainerNummer>
    <Type>${containertype}</Type>
    <Klantreferentie>${klantreferentie}</Klantreferentie>
    <Bootnaam>${bootnaam}</Bootnaam>
    <Rederij>${rederij}</Rederij>
    <Uithaalreferentie>${laadreferentie}</Uithaalreferentie>
    <Inleverreferentie>${inleverreferentie}</Inleverreferentie>
    <IMO>${imo}</IMO>
    <Gewicht>${gewicht}</Gewicht>
    <Temperatuur>${temperatuur}</Temperatuur>
    <Volume>${volume}</Volume>
  </Container>
  <Locaties>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Laden</Actie>
      <Naam>${klantreferentie}</Naam>
      <Adres>${laadadres}</Adres>
      <Postcode>${laadpostcode}</Postcode>
      <Plaats>${laadplaats}</Plaats>
    </Locatie>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Inleveren</Actie>
      <Naam>${klantreferentie}</Naam>
      <Adres>${inleveradres}</Adres>
      <Postcode>${inleverpostcode}</Postcode>
      <Plaats>${inleverplaats}</Plaats>
    </Locatie>
  </Locaties>
  <Financieel>
    <Vrachtprijs>0</Vrachtprijs>
    <WachttijdGratisMinuten>0</WachttijdGratisMinuten>
    <ExtraKostenNaGratisWachttijd>0</ExtraKostenNaGratisWachttijd>
    <Toeslag>0</Toeslag>
    <Brandstoftoeslag>0</Brandstoftoeslag>
    <Korting>0</Korting>
    <Valuta>EUR</Valuta>
    <BTWPercentage>0</BTWPercentage>
  </Financieel>
</Transport>`;

  return xml;
}