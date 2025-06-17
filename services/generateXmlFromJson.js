
export function generateXmlFromJson(json) {
  const klantreferentie = json.klantreferentie || 'Onbekend';
  const laadplaats = json.laadplaats || 'Onbekend';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Easytrip>
  <Klantreferentie>${klantreferentie}</Klantreferentie>
  <Laadplaats>${laadplaats}</Laadplaats>
</Easytrip>`;
}
