import fs from 'fs';

// Monkey patch: blokkeer toegang tot testbestand in pdf-parse
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function(path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

export async function parsePdfToEasyFile(pdfBuffer) {
  const pdfParse = (await import('pdf-parse')).default;
  const { text } = await pdfParse(pdfBuffer);

  // Check of het waarschijnlijk een transportopdracht is
  const requiredLabels = ['Our reference', 'Container', 'Pick-up terminal', 'Drop-off terminal'];
  const missingLabels = requiredLabels.filter(label => !text.includes(label));
  if (missingLabels.length > 0) {
    throw new Error(`PDF lijkt geen transportopdracht. Ontbrekend: ${missingLabels.join(', ')}`);
  }

  const get = (label) => {
    const match = text.match(new RegExp(`${label}:?\\s*(.+)`, 'i'));
    return match ? match[1].trim() : '';
  };

  const klantreferentie = get('Our reference');
  const bootnaam = get('Vessel');
  const rederij = get('Carrier');
  const containernummer = get('Container');
  const containertype = get('Type');
  const laadreferentie = get('Pick-up reference');
  const inleverreferentie = get('Drop-off reference');
  const temperatuur = get('Temperature');
  const imo = get('UN');
  const gewicht = get('Weight');
  const volume = get('Volume');
  const laadplaats = get('Pick-up terminal');
  const losplaats = get('Drop-off terminal');

  // Extra controle op verplichte velden
  const verplichteVelden = {
    'Our reference': klantreferentie,
    'Container': containernummer,
    'Pick-up terminal': laadplaats,
    'Drop-off terminal': losplaats
  };

  const ontbrekend = Object.entries(verplichteVelden)
    .filter(([label, value]) => !value)
    .map(([label]) => label);

  if (ontbrekend.length > 0) {
    throw new Error(`Onvoldoende gegevens in PDF. Ontbrekend: ${ontbrekend.join(', ')}`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<EasyTrip>
  <Klantreferentie>${klantreferentie}</Klantreferentie>
  <Bootnaam>${bootnaam}</Bootnaam>
  <Rederij>${rederij}</Rederij>
  <Container>
    <Nummer>${containernummer}</Nummer>
    <Type>${containertype}</Type>
    <Uithaalreferentie>${laadreferentie}</Uithaalreferentie>
    <Inleverreferentie>${inleverreferentie}</Inleverreferentie>
    <Temperatuur>${temperatuur}</Temperatuur>
    <UN>${imo}</UN>
    <Gewicht>${gewicht}</Gewicht>
    <Volume>${volume}</Volume>
  </Container>
  <Locaties>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Laden</Actie>
      <Naam>${laadplaats}</Naam>
      <Adres></Adres>
      <Postcode></Postcode>
      <Plaats>${laadplaats}</Plaats>
    </Locatie>
    <Locatie>
      <Volgorde>0</Volgorde>
      <Actie>Inleveren</Actie>
      <Naam>${losplaats}</Naam>
      <Adres></Adres>
      <Postcode></Postcode>
      <Plaats>${losplaats}</Plaats>
    </Locatie>
  </Locaties>
  <Financieel>
    <Vracht>0</Vracht>
    <Wachturen>0</Wachturen>
    <Kostprijs>0</Kostprijs>
    <BetaaldDoor>klant</BetaaldDoor>
  </Financieel>
</EasyTrip>`;

  return xml;
}