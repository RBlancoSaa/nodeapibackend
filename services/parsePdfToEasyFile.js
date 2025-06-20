export async function parsePdfToEasyFile(pdfBuffer) { // [1]
  const pdfParse = (await import('pdf-parse')).default; // [2]
  const { text } = await pdfParse(pdfBuffer); // [3]

  const get = (label) => { // [4]
    const match = text.match(new RegExp(`${label}:?\\s*(.+)`, 'i')); // [5]
    return match ? match[1].trim() : ''; // [6]
  }; // [7]

  const klantreferentie = get('Our reference'); // [8]
  const bootnaam = get('Vessel'); // [9]
  const rederij = get('Carrier'); // [10]
  const containernummer = get('Container'); // [11]
  const containertype = get('Type'); // [12]
  const laadreferentie = get('Pick-up reference'); // [13]
  const inleverreferentie = get('Drop-off reference'); // [14]
  const temperatuur = get('Temperature'); // [15]
  const imo = get('UN'); // [16]
  const gewicht = get('Weight'); // [17]
  const volume = get('Volume'); // [18]
  const laadplaats = get('Pick-up terminal'); // [19]
  const losplaats = get('Drop-off terminal'); // [20]

  if (!klantreferentie || !containernummer || !laadplaats || !losplaats) { // [21]
    throw new Error('Onvoldoende gegevens in PDF voor Easyfile'); // [22]
  } // [23]

  const xml = `<?xml version="1.0" encoding="UTF-8"?> // [24]
<EasyTrip> // [25]
  <Klantreferentie>${klantreferentie}</Klantreferentie> // [26]
  <Bootnaam>${bootnaam}</Bootnaam> // [27]
  <Rederij>${rederij}</Rederij> // [28]
  <Container> // [29]
    <Nummer>${containernummer}</Nummer> // [30]
    <Type>${containertype}</Type> // [31]
    <Uithaalreferentie>${laadreferentie}</Uithaalreferentie> // [32]
    <Inleverreferentie>${inleverreferentie}</Inleverreferentie> // [33]
    <Temperatuur>${temperatuur}</Temperatuur> // [34]
    <UN>${imo}</UN> // [35]
    <Gewicht>${gewicht}</Gewicht> // [36]
    <Volume>${volume}</Volume> // [37]
  </Container> // [38]
  <Locaties> // [39]
    <Locatie> // [40]
      <Volgorde>0</Volgorde> // [41]
      <Actie>Laden</Actie> // [42]
      <Naam>${laadplaats}</Naam> // [43]
      <Adres></Adres> // [44]
      <Postcode></Postcode> // [45]
      <Plaats>${laadplaats}</Plaats> // [46]
    </Locatie> // [47]
    <Locatie> // [48]
      <Volgorde>0</Volgorde> // [49]
      <Actie>Inleveren</Actie> // [50]
      <Naam>${losplaats}</Naam> // [51]
      <Adres></Adres> // [52]
      <Postcode></Postcode> // [53]
      <Plaats>${losplaats}</Plaats> // [54]
    </Locatie> // [55]
  </Locaties> // [56]
  <Financieel> // [57]
    <Vracht>0</Vracht> // [58]
    <Wachturen>0</Wachturen> // [59]
    <Kostprijs>0</Kostprijs> // [60]
    <BetaaldDoor>klant</BetaaldDoor> // [61]
  </Financieel> // [62]
</EasyTrip>`; // [63]

  return xml; // [64]
} // [65]
