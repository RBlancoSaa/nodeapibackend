import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

export async function parsePdfToEasyFile(pdfBuffer) {
  const parsed = await parseJordex(pdfBuffer);

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<Order>
<Dossiers>
<Dossier>
<Opdrachtgever>
<Opdrachtgever>${parsed.opdrachtgeverNaam}</Opdrachtgever>
<Opdrachtgever_Adres>${parsed.opdrachtgeverAdres}</Opdrachtgever_Adres>
<Opdrachtgever_Postcode>${parsed.opdrachtgeverPostcode}</Opdrachtgever_Postcode>
<Opdrachtgever_Plaats>${parsed.opdrachtgeverPlaats}</Opdrachtgever_Plaats>
<Opdrachtgever_TelefoonNummer>${parsed.opdrachtgeverTelefoon}</Opdrachtgever_TelefoonNummer>
<Opdrachtgever_Email>${parsed.opdrachtgeverEmail}</Opdrachtgever_Email>
<Opdrachtgever_BTW>${parsed.opdrachtgeverBTW}</Opdrachtgever_BTW>
<Opdrachtgever_KVK>${parsed.opdrachtgeverKVK}</Opdrachtgever_KVK>
</Opdrachtgever>
<Container>
<Ritnr>${parsed.ritnummer}</Ritnr>
<Laden_Lossen>${parsed.ladenOfLossen}</Laden_Lossen>
<Type>${parsed.type}</Type>
<Datum>${parsed.datum}</Datum>
<TijdVan>${parsed.tijdVan}</TijdVan>
<TijdTM>${parsed.tijdTM}</TijdTM>
<Container>${parsed.containernummer}</Container>
<ContainerType>${parsed.containertype}</ContainerType>
<Lading>${parsed.lading}</Lading>
<ADR>${parsed.adr}</ADR>
<Tarra>${parsed.tarra}</Tarra>
<GeladenGewicht>${parsed.geladenGewicht}</GeladenGewicht>
<Brutogewicht>${parsed.brutogewicht}</Brutogewicht>
<Colli>${parsed.colli}</Colli>
<Zegel>${parsed.zegel}</Zegel>
<Temp>${parsed.temperatuur}</Temp>
<CBM>${parsed.cbm}</CBM>
<Brix>${parsed.brix}</Brix>
<Referentie>${parsed.referentie}</Referentie>
<Bootnaam>${parsed.bootnaam}</Bootnaam>
<Rederij>${parsed.rederij}</Rederij>
<Documentatie>${parsed.documentatie}</Documentatie>
<TAR>${parsed.tar}</TAR>
<Laadrefentie>${parsed.laadreferentie}</Laadrefentie>
<Meldtijd>${parsed.meldtijd}</Meldtijd>
<Inleverrefentie>${parsed.inleverreferentie}</Inleverrefentie>
<InleverBootnaam>${parsed.inleverBootnaam}</InleverBootnaam>
<InleverBestemming>${parsed.inleverBestemming}</InleverBestemming>
<InleverRederij>${parsed.inleverRederij}</InleverRederij>
<Inlever_TAR>${parsed.inleverTAR}</Inlever_TAR>
<Closing_datum>${parsed.closingDatum}</Closing_datum>
<Closing_tijd>${parsed.closingTijd}</Closing_tijd>
<Instructies>${parsed.instructies}</Instructies>
</Container>
<Locaties>
<Locatie>
<Volgorde>${parsed.volgorde1}</Volgorde>
<Actie>${parsed.actie1}</Actie>
<Naam>${parsed.naam1}</Naam>
<Adres>${parsed.adres1}</Adres>
<Postcode>${parsed.postcode1}</Postcode>
<Plaats>${parsed.plaats1}</Plaats>
<Land>${parsed.land1}</Land>
<Voorgemeld>${parsed.voorgemeld1}</Voorgemeld>
<Aankomst_verw>${parsed.aankomstVerw1}</Aankomst_verw>
<Tijslot_van>${parsed.tijslotVan1}</Tijslot_van>
<Tijslot_tm>${parsed.tijslotTm1}</Tijslot_tm>
<Portbase_code>${parsed.portbaseCode1}</Portbase_code>
<bicsCode>${parsed.bicsCode1}</bicsCode>
</Locatie>
<Locatie>
<Volgorde>${parsed.volgorde2}</Volgorde>
<Actie>${parsed.actie2}</Actie>
<Naam>${parsed.naam2}</Naam>
<Adres>${parsed.adres2}</Adres>
<Postcode>${parsed.postcode2}</Postcode>
<Plaats>${parsed.plaats2}</Plaats>
<Land>${parsed.land2}</Land>
</Locatie>
<Locatie>
<Volgorde>${parsed.volgorde3}</Volgorde>
<Actie>${parsed.actie3}</Actie>
<Naam>${parsed.naam3}</Naam>
<Adres>${parsed.adres3}</Adres>
<Postcode>${parsed.postcode3}</Postcode>
<Plaats>${parsed.plaats3}</Plaats>
<Land>${parsed.land3}</Land>
<Voorgemeld>${parsed.voorgemeld3}</Voorgemeld>
<Aankomst_verw>${parsed.aankomstVerw3}</Aankomst_verw>
<Tijslot_van>${parsed.tijslotVan3}</Tijslot_van>
<Tijslot_tm>${parsed.tijslotTm3}</Tijslot_tm>
<Portbase_code>${parsed.portbaseCode3}</Portbase_code>
<bicsCode>${parsed.bicsCode3}</bicsCode>
</Locatie>
</Locaties>
<Financieel>
<Tarief>${parsed.tarief}</Tarief>
<BTW>${parsed.btw}</BTW>
<ADR_toeslag_Chart>${parsed.adrToeslagChart}</ADR_toeslag_Chart>
<ADR_bedrag_Chart>${parsed.adrBedragChart}</ADR_bedrag_Chart>
<Botlek_Chart>${parsed.botlekChart}</Botlek_Chart>
<Chassishuur_Bedrag_chart>${parsed.chassishuurChart}</Chassishuur_Bedrag_chart>
<Delta_Chart>${parsed.deltaChart}</Delta_Chart>
<Diesel_toeslag_Chart>${parsed.dieselChart}</Diesel_toeslag_Chart>
<Euromax_Chart>${parsed.euromaxChart}</Euromax_Chart>
<ExtraStop_Chart>${parsed.extraStopChart}</ExtraStop_Chart>
<GasMeten_Chart>${parsed.gasMetenChart}</GasMeten_Chart>
<Gen_Chart>${parsed.genChart}</Gen_Chart>
<Handrail_Bedrag_chart>${parsed.handrailChart}</Handrail_Bedrag_chart>
<Keuren_Chart>${parsed.keurenChart}</Keuren_Chart>
<Kilometers_Chart>${parsed.kilometersChart}</Kilometers_Chart>
<LOever_Chart>${parsed.loeverChart}</LOever_Chart>
<Loods_Chart>${parsed.loodsChart}</Loods_Chart>
<Maut_Chart>${parsed.mautChart}</Maut_Chart>
<MV2_Chart>${parsed.mv2Chart}</MV2_Chart>
<Scannen_Chart>${parsed.scannenChart}</Scannen_Chart>
<Tol_Chart>${parsed.tolChart}</Tol_Chart>
<Blanco1_Chart>${parsed.blanco1Chart}</Blanco1_Chart>
<Blanco1_Text>${parsed.blanco1Text}</Blanco1_Text>
<Blanco2_Chart>${parsed.blanco2Chart}</Blanco2_Chart>
<Blanco2_Text>${parsed.blanco2Text}</Blanco2_Text>
</Financieel>
</Dossier>
</Dossiers>
</Order>`;

  return xml;
}
