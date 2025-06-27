import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function parseJordex(pdfBuffer) {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text;

    let dropoffMatch = null;
    let pickupMatch = null;
    let containertypeMatch = null;
    let rederijMatch = null;
    let bestemmingMatch = null;

    const rawDropoffTerminal = (text.match(/Drop-off terminal\s+Address:\s*(.*)/i) || [])[1] || '';
    const rawPickupTerminal = (text.match(/Pick-up terminal\s+Address:\s*(.*)/i) || [])[1] || '';
    const rawContainertype = (text.match(/(\d{2})['’]?\s+high\s+cube\s+reefer/i) || [])[0] || '';
    const rawRederij = (text.match(/Carrier:\s*(.*)/i) || [])[1] || '';
    const rawInleverBestemming = (text.match(/To:\s*(.*)/i) || [])[1] || '';

    const dropoffResult = await supabase
      .from('terminals')
      .select('naam, adres, postcode, plaats, portbase_code, bics_code, voorgemeld, aankomst_verwacht, tijslot_van, tijslot_tm')
      .eq('naam', rawDropoffTerminal)
      .maybeSingle();
    dropoffMatch = dropoffResult?.data || null;
    if (!dropoffMatch) console.warn('⚠️ Geen match voor drop-off terminal:', rawDropoffTerminal);

    const pickupResult = await supabase
      .from('terminals')
      .select('naam, adres, postcode, plaats, portbase_code, bics_code, voorgemeld, aankomst_verwacht, tijslot_van, tijslot_tm')
      .eq('naam', rawPickupTerminal)
      .maybeSingle();
    pickupMatch = pickupResult?.data || null;
    if (!pickupMatch) console.warn('⚠️ Geen match voor pick-up terminal:', rawPickupTerminal);

    const containertypeResult = await supabase
      .from('containertypes')
      .select('naam')
      .eq('naam', rawContainertype)
      .maybeSingle();
    containertypeMatch = containertypeResult?.data || null;
    if (!containertypeMatch) console.warn('⚠️ Geen match voor containertype:', rawContainertype);

    const rederijResult = await supabase
      .from('rederijen')
      .select('naam')
      .eq('naam', rawRederij)
      .maybeSingle();
    rederijMatch = rederijResult?.data || null;
    if (!rederijMatch) console.warn('⚠️ Geen match voor rederij:', rawRederij);

    const bestemmingResult = await supabase
      .from('inleverlocaties')
      .select('naam')
      .eq('naam', rawInleverBestemming)
      .maybeSingle();
    bestemmingMatch = bestemmingResult?.data || null;
    if (!bestemmingMatch) console.warn('⚠️ Geen match voor inleverbestemming:', rawInleverBestemming);

const opdrachtgeverNaam = (text.match(/Opdrachtgever:\s*(.*)/i) || [])[1] || '';
const opdrachtgeverAdres = (text.match(/Adres:\s*(.*)/i) || [])[1] || '';
const opdrachtgeverPostcode = (text.match(/Postcode:\s*(\d{4}\s?[A-Z]{2})/i) || [])[1] || '';
const opdrachtgeverPlaats = (text.match(/Plaats:\s*(.*)/i) || [])[1] || '';
const opdrachtgeverTelefoon = (text.match(/Tel(?:ef)?(?:oonnummer)?:\s*([\d\-+() ]{6,})/i) || [])[1] || '';
const opdrachtgeverEmail = (text.match(/E-?mail:\s*([\w.-]+@[\w.-]+\.\w+)/i) || [])[1] || '';
const opdrachtgeverBTW = (text.match(/BTW(?:-nummer)?:\s*([\w\d.-]+)/i) || [])[1] || '';
const opdrachtgeverKVK = (text.match(/K\.?v\.?K\.?:?\s*(\d{8})/i) || [])[1] || '';

const referentie = (text.match(/Our reference:\s*(\S+)/i) || [])[1] || '';
const type = (text.match(/(\d{2})['’]?\s+high\s+cube\s+reefer/i) || [])[0] || '';
const lading = (text.match(/Description\s*\n(.*)/i) || [])[1] || 'FROZEN PORK';
const temperatuur = (text.match(/Temperature:\s*(-?\d+)[°º]C/i) || [])[1] || '';
const cbm = (text.match(/(\d{2,5})m³/i) || [])[1] || '';
const gewicht = (text.match(/(\d{2,5})\s?kg/i) || [])[1] || '';
const colli = (text.match(/Colli\s*(\d+)/i) || [])[1] || '';
const bootnaam = (text.match(/Vessel:\s*(.*)/i) || [])[1] || '';
const closingDatum = (text.match(/Document closing:\s*(\d{2}\s\w{3}\s\d{4})/i) || [])[1] || '';
const closingTijd = (text.match(/Document closing:\s*\d{2}\s\w{3}\s\d{4}\s+(\d{2}:\d{2})/i) || [])[1] || '';
const laadreferentie = (text.match(/Pick-up[\s\S]*?Reference\(s\):\s*(\d+)/i) || [])[1] || '';
const inleverreferentie = (text.match(/Drop-off terminal[\s\S]*?Reference\(s\):\s*(\d+)/i) || [])[1] || '';
const documentatie = (text.match(/Document closing:\s*(.*)/i) || [])[1] || '';

// 📍 Klant (Pick-up) = locatie 1
const portbaseCode1 = '';
const bicsCode1 = '';
const voorgemeld1 = '';
const aankomstVerw1 = '';
const tijslotVan1 = '';
const tijslotTm1 = '';
const naam1 = (text.match(/Pick-up\s+Address:\s*(.*)/i) || [])[1] || '';
const adres1 = (text.match(/Pick-up\s+Address:[\s\S]*?\n(.*)/i) || [])[1] || '';
const postcode1 = (text.match(/Pick-up\s+Address:[\s\S]*?\n.*\n(\d{4}\s?[A-Z]{2})/i) || [])[1] || '';
const plaats1 = (text.match(/Pick-up\s+Address:[\s\S]*?\n.*\n\d{4}\s?[A-Z]{2}\s*(.*)/i) || [])[1] || '';
const land1 = 'NL';
const actie1 = 'Laden';
const volgorde1 = '0';

// 📍 Drop-off terminal (locatie 2)
const naam2 = dropoffMatch?.naam || '';
const adres2 = dropoffMatch?.adres || '';
const postcode2 = dropoffMatch?.postcode || '';
const plaats2 = dropoffMatch?.plaats || '';
const land2 = 'NL';
const actie2 = 'Inleveren';
const volgorde2 = '0';

// 📍 Pick-up terminal (locatie 3)
const naam3 = pickupMatch?.naam || '';
const adres3 = pickupMatch?.adres || '';
const postcode3 = pickupMatch?.postcode || '';
const plaats3 = pickupMatch?.plaats || '';
const land3 = 'NL';
const actie3 = 'Uithalen';
const volgorde3 = '0';

// 🔍 Uit PDF gehaald
const rawContainertype = (text.match(/(\d{2})['’]?\s+high\s+cube\s+reefer/i) || [])[0] || '';
const rawRederij = (text.match(/Carrier:\s*(.*)/i) || [])[1] || '';
const rawInleverBestemming = (text.match(/To:\s*(.*)/i) || [])[1] || '';

// ✅ Valideer containertype exact
const { data: containertypeMatch } = await supabase
  .from('containertypes')
  .select('naam')
  .eq('naam', rawContainertype)
  .maybeSingle();

const containertype = containertypeMatch?.naam || '';
if (!containertype) console.warn('⚠️ Geen match voor containertype:', rawContainertype);

// ✅ Valideer rederij exact
const { data: rederijMatch } = await supabase
  .from('rederijen')
  .select('naam')
  .eq('naam', rawRederij)
  .maybeSingle();

const rederij = rederijMatch?.naam || '';
if (!rederij) console.warn('⚠️ Geen match voor rederij:', rawRederij);

// ✅ Valideer inleverbestemming exact
const { data: bestemmingMatch } = await supabase
  .from('inleverlocaties')
  .select('naam')
  .eq('naam', rawInleverBestemming)
  .maybeSingle();

const inleverBestemming = bestemmingMatch?.naam || '';
if (!inleverBestemming) console.warn('⚠️ Geen match voor inleverbestemming:', rawInleverBestemming);

// 🔍 Haal ruwe terminalnamen uit PDF
const rawDropoffTerminal = (text.match(/Drop-off terminal\s+Address:\s*(.*)/i) || [])[1] || '';
const rawPickupTerminal = (text.match(/Pick-up terminal\s+Address:\s*(.*)/i) || [])[1] || '';

// ✅ Supabase lookup drop-off terminal
const { data: dropoffMatch } = await supabase
  .from('terminals')
  .select('naam, adres, postcode, plaats, portbase_code, bics_code, voorgemeld, aankomst_verwacht, tijslot_van, tijslot_tm')
  .eq('naam', rawDropoffTerminal)
  .maybeSingle();

if (!dropoffMatch) console.warn('⚠️ Geen match voor drop-off terminal:', rawDropoffTerminal);

const portbaseCode2 = dropoffMatch?.portbase_code || '';
const bicsCode2 = dropoffMatch?.bics_code || '';
const voorgemeld2 = dropoffMatch?.voorgemeld || '';
const aankomstVerw2 = dropoffMatch?.aankomst_verwacht || '';
const tijslotVan2 = dropoffMatch?.tijslot_van || '';
const tijslotTm2 = dropoffMatch?.tijslot_tm || '';

// ✅ Supabase lookup pick-up terminal
const { data: pickupMatch } = await supabase
  .from('terminals')
  .select('naam, adres, postcode, plaats, portbase_code, bics_code, voorgemeld, aankomst_verwacht, tijslot_van, tijslot_tm')
  .eq('naam', rawPickupTerminal)
  .maybeSingle();

if (!pickupMatch) console.warn('⚠️ Geen match voor pick-up terminal:', rawPickupTerminal);

const portbaseCode3 = pickupMatch?.portbase_code || '';
const bicsCode3 = pickupMatch?.bics_code || '';
const voorgemeld3 = pickupMatch?.voorgemeld || '';
const aankomstVerw3 = pickupMatch?.aankomst_verwacht || '';
const tijslotVan3 = pickupMatch?.tijslot_van || '';
const tijslotTm3 = pickupMatch?.tijslot_tm || '';

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
    <Voorgemeld>${voorgemeld2}</Voorgemeld>
    <Aankomst_verw>${aankomstVerw2}</Aankomst_verw>
    <Tijslot_van>${tijslotVan2}</Tijslot_van>
    <Tijslot_tm>${tijslotTm2}</Tijslot_tm>
    <Portbase_code>${portbaseCode2}</Portbase_code>
    <bicsCode>${bicsCode2}</bicsCode>
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

    return xml; // ✅ binnen try
  } catch (err) {
    console.error('❌ Fout in parseJordex:', err.message);
    throw err;
  }
}