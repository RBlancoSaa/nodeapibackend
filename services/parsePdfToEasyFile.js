export async function parsePdfToEasyFile(pdfBuffer) {
  const pdfParse = (await import('pdf-parse')).default; // ✅ dynamisch

  const result = await pdfParse(pdfBuffer); // ✅ geen destructuring
  const text = result.text;

  const get = (label) => {
    const match = text.match(new RegExp(`${label}:?\\s*(.+)`, 'i'));
    return match ? match[1].trim() : '';
  };

  const referentie = get('Our reference');
  const remark = get('Remark');
  const from = get('From');
  const to = get('To');
  const carrier = get('Carrier');
  const vessel = get('Vessel');
  const container = get('Container');
  const containerType = get('Type');
  const pickupRef = get('Pick-up reference');
  const dropoffRef = get('Drop-off reference');
  const temperatuur = get('Temperature');
  const unNumber = get('UN');
  const gewicht = get('Weight');
  const volume = get('Volume');
  const locatieLaden = get('Pick-up terminal');
  const locatieLossen = get('Drop-off terminal');

  if (!referentie || !container || !locatieLaden || !locatieLossen) {
    throw new Error('Onvoldoende gegevens in PDF voor Easyfile');
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<Easytrip>
  <Klantreferentie>${referentie}</Klantreferentie>
  <Opmerking>${remark}</Opmerking>
  <Bootnaam>${vessel}</Bootnaam>
  <Rederij>${carrier}</Rederij>
  <Container>
    <Containernummer>${container}</Containernummer>
    <Formaat>${containerType || '45G1'}</Formaat>
    <BRIX>0</BRIX>
    <ADR>${unNumber}</ADR>
    <Temperatuur>${temperatuur}</Temperatuur>
    <Volume>${volume}</Volume>
    <Gewicht>${gewicht}</Gewicht>
  </Container>
  <Locaties>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Laden</Actie>
      <Naam>${locatieLaden}</Naam>
      <Adres></Adres>
      <Postcode></Postcode>
      <Plaats></Plaats>
      <Uithaalreferentie>${pickupRef}</Uithaalreferentie>
    </Locatie>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Lossen</Actie>
      <Naam>${locatieLossen}</Naam>
      <Adres></Adres>
      <Postcode></Postcode>
      <Plaats></Plaats>
      <Inleverreferentie>${dropoffRef}</Inleverreferentie>
    </Locatie>
  </Locaties>
</Easytrip>`;

  return xml;
}