export async function parsePdfToEasyFile(pdfBuffer) {
  const pdfParse = (await import('pdf-parse')).default;
  const { text } = await pdfParse(pdfBuffer);

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

  if (!klantreferentie || !containernummer || !laadplaats || !losplaats) {
    throw new Error('Onvoldoende gegevens in PDF voor Easyfile');
  }

  return {
    klantreferentie,
    bootnaam,
    rederij,
    containernummer,
    containertype,
    laadreferentie,
    inleverreferentie,
    temperatuur,
    imo,
    gewicht,
    volume,
    laadplaats,
    inleverplaats: losplaats,
    laadadres: '',
    laadpostcode: '',
    inleveradres: '',
    inleverpostcode: ''
  };
}