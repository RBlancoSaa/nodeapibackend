import fs from 'fs';

// Monkey patch: blokkeer toegang tot testbestand in pdf-parse
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
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
  const containernummer = get('Container');
  const containertype = get('Type');
  const bootnaam = get('Vessel');
  const rederij = get('Carrier');
  const laadreferentie = get('Pick-up reference');
  const inleverreferentie = get('Drop-off reference');
  const temperatuur = get('Temperature');
  const imo = get('UN');
  const gewicht = get('Weight');
  const volume = get('Volume');
  const laadplaats = get('Pick-up terminal');
  const losplaats = get('Drop-off terminal');

  // ⚠️ Dummy values — voeg jouw echte mapping toe op basis van PDF!
  const datum = '2025-06-23';
  const tijdVan = '08:00';
  const tijdTM = '17:00';

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Order>
<Dossiers>
<Dossier>
<Opdrachtgever>
<Opdrachtgever>${opdrachtgeverNaam}</Opdrachtgever>
<Opdrachtgever_Adres>${opdrachtgeverAdres}</Opdrachtgever_Adres>
<Opdrachtgever_Postcode>${opdrachtgeverPostcode}</Opdrachtgever_Postcode>
<Opdrachtgever_Plaats>${opdrachtgeverPlaats}</Opdrachtgever_Plaats>
<Opdrachtgever_TelefoonNummer>${opdrachtgeverTelefoon}</Opdrachtgever_TelefoonNummer>
<Opdrachtgever_Email>${opdrachtgeverEmail}</Opdrachtgever_Email>
<Opdrachtgever_BTW>${opdrachtgeverBTW}</Opdrachtgever_BTW>
<Opdrachtgever_KVK>${opdrachtgeverKVK}</Opdrachtgever_KVK>
</Opdrachtgever>
<Container>
<Ritnr>${ritnummer}</Ritnr>
<Laden_Lossen>${ladenOfLossen}</Laden_Lossen>
<Type>${type}</Type>
<Datum>${datum}</Datum>
<TijdVan>${tijdVan}</TijdVan>
<TijdTM>${tijdTM}</TijdTM>
<Container>${containernummer}</Container>
<ContainerType>${containertype}</ContainerType>
<Lading>${lading}</Lading>
<ADR>${adr}</ADR>
<Tarra>${tarra}</Tarra>
<GeladenGewicht>${geladenGewicht}</GeladenGewicht>
<Brutogewicht>${brutogewicht}</Brutogewicht>
<Colli>${colli}</Colli>
<Zegel>${zegel}</Zegel>
<Temp>${temperatuur}</Temp>
<CBM>${cbm}</CBM>
<Brix>${brix}</Brix>
<Referentie>${referentie}</Referentie>
<Bootnaam>${bootnaam}</Bootnaam>
<Rederij>${rederij}</Rederij>
<Documentatie>${documentatie}</Documentatie>
<TAR>${tar}</TAR>
<Laadrefentie>${laadreferentie}</Laadrefentie>
<Meldtijd>${meldtijd}</Meldtijd>
<Inleverrefentie>${inleverreferentie}</Inleverrefentie>
<InleverBootnaam>${inleverBootnaam}</InleverBootnaam>
<InleverBestemming>${inleverBestemming}</InleverBestemming>
<InleverRederij>${inleverRederij}</InleverRederij>
<Inlever_TAR>${inleverTAR}</Inlever_TAR>
<Closing_datum>${closingDatum}</Closing_datum>
<Closing_tijd>${closingTijd}</Closing_tijd>
<Instructies>${instructies}</Instructies>
</Container>
<Locaties>
<Locatie>
<Volgorde>${volgorde1}</Volgorde>
<Actie>${actie1}</Actie>
<Naam>${naam1}</Naam>
<Adres>${adres1}</Adres>
<Postcode>${postcode1}</Postcode>
<Plaats>${plaats1}</Plaats>
<Land>${land1}</Land>
<Voorgemeld>${voorgemeld1}</Voorgemeld>
<Aankomst_verw>${aankomstVerw1}</Aankomst_verw>
<Tijslot_van>${tijslotVan1}</Tijslot_van>
<Tijslot_tm>${tijslotTm1}</Tijslot_tm>
<Portbase_code>${portbaseCode1}</Portbase_code>
<bicsCode>${bicsCode1}</bicsCode>
</Locatie>
<Locatie>
<Volgorde>${volgorde2}</Volgorde>
<Actie>${actie2}</Actie>
<Naam>${naam2}</Naam>
<Adres>${adres2}</Adres>
<Postcode>${postcode2}</Postcode>
<Plaats>${plaats2}</Plaats>
<Land>${land2}</Land>
</Locatie>
<Locatie>
<Volgorde>${volgorde3}</Volgorde>
<Actie>${actie3}</Actie>
<Naam>${naam3}</Naam>
<Adres>${adres3}</Adres>
<Postcode>${postcode3}</Postcode>
<Plaats>${plaats3}</Plaats>
<Land>${land3}</Land>
<Voorgemeld>${voorgemeld3}</Voorgemeld>
<Aankomst_verw>${aankomstVerw3}</Aankomst_verw>
<Tijslot_van>${tijslotVan3}</Tijslot_van>
<Tijslot_tm>${tijslotTm3}</Tijslot_tm>
<Portbase_code>${portbaseCode3}</Portbase_code>
<bicsCode>${bicsCode3}</bicsCode>
</Locatie>
</Locaties>
<Financieel>
<Tarief>${tarief}</Tarief>
<BTW>${btw}</BTW>
<ADR_toeslag_Chart>${adrToeslagChart}</ADR_toeslag_Chart>
<ADR_bedrag_Chart>${adrBedragChart}</ADR_bedrag_Chart>
<Botlek_Chart>${botlekChart}</Botlek_Chart>
<Chassishuur_Bedrag_chart>${chassishuurChart}</Chassishuur_Bedrag_chart>
<Delta_Chart>${deltaChart}</Delta_Chart>
<Diesel_toeslag_Chart>${dieselChart}</Diesel_toeslag_Chart>
<Euromax_Chart>${euromaxChart}</Euromax_Chart>
<ExtraStop_Chart>${extraStopChart}</ExtraStop_Chart>
<GasMeten_Chart>${gasMetenChart}</GasMeten_Chart>
<Gen_Chart>${genChart}</Gen_Chart>
<Handrail_Bedrag_chart>${handrailChart}</Handrail_Bedrag_chart>
<Keuren_Chart>${keurenChart}</Keuren_Chart>
<Kilometers_Chart>${kilometersChart}</Kilometers_Chart>
<LOever_Chart>${loeverChart}</LOever_Chart>
<Loods_Chart>${loodsChart}</Loods_Chart>
<Maut_Chart>${mautChart}</Maut_Chart>
<MV2_Chart>${mv2Chart}</MV2_Chart>
<Scannen_Chart>${scannenChart}</Scannen_Chart>
<Tol_Chart>${tolChart}</Tol_Chart>
<Blanco1_Chart>${blanco1Chart}</Blanco1_Chart>
<Blanco1_Text>${blanco1Text}</Blanco1_Text>
<Blanco2_Chart>${blanco2Chart}</Blanco2_Chart>
<Blanco2_Text>${blanco2Text}</Blanco2_Text>
</Financieel>
</Dossier>
</Dossiers>
</Order>
  return xml;
}