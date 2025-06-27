import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// 🛡️ Monkey patch: blokkeer toegang tot testbestand in pdf-parse
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

export async function parseJordex(pdfBuffer) {
  const pdfParse = (await import('pdf-parse')).default;
  const { text } = await pdfParse(pdfBuffer);

  const get = (label) => {
    const match = text.match(new RegExp(`${label}:?\s*(.+)`, 'i'));
    return match ? match[1].trim() : '';
  };

  // 📥 Basisgegevens uit PDF
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

  const datum = '';
  const tijdVan = '';
  const tijdTM = '';

  const referentie = klantreferentie;
  const ritnummer = 'AUTO';
  const ladenOfLossen = containernummer ? 'Lossen' : 'Laden';
  const type = 'Container';
  const lading = '';
  const adr = imo;
  const tarra = '';
  const geladenGewicht = gewicht;
  const brutogewicht = gewicht;
  const colli = '';
  const zegel = '';
  const cbm = volume;
  const brix = '';
  const documentatie = '';
  const tar = '';
  const meldtijd = '';
  const inleverBootnaam = bootnaam;
  const inleverBestemming = losplaats;
  const inleverRederij = rederij;
  const inleverTAR = '';
  const closingDatum = '';
  const closingTijd = '';
  const instructies = '';

  const opdrachtgeverNaam = get('Opdrachtgever') || '';
  const opdrachtgeverAdres = get('Opdrachtgever adres') || '';
  const opdrachtgeverPostcode = get('Opdrachtgever postcode') || '';
  const opdrachtgeverPlaats = get('Opdrachtgever plaats') || '';
  const opdrachtgeverTelefoon = get('Opdrachtgever telefoon') || '';
  const opdrachtgeverEmail = get('Opdrachtgever email') || '';
  const opdrachtgeverBTW = get('Opdrachtgever btw') || '';
  const opdrachtgeverKVK = get('Opdrachtgever kvk') || '';

  const naam1 = laadplaats;
  const naam2 = 'Onderweg';
  const naam3 = losplaats;

  const locatieResult1 = await supabase.from('locaties').select('*').eq('naam', laadplaats).maybeSingle();
  const locatieResult3 = await supabase.from('locaties').select('*').eq('naam', losplaats).maybeSingle();

  const locatie1 = locatieResult1.data || {};
  const locatie3 = locatieResult3.data || {};

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
<Volgorde>0</Volgorde>
<Actie>${ladenOfLossen}</Actie>
<Naam>${naam1}</Naam>
<Adres>${locatie1.adres || ''}</Adres>
<Postcode>${locatie1.postcode || ''}</Postcode>
<Plaats>${locatie1.plaats || ''}</Plaats>
<Land>${locatie1.land || 'NL'}</Land>
<Voorgemeld>${locatie1.voorgemeld || ''}</Voorgemeld>
<Aankomst_verw></Aankomst_verw>
<Tijslot_van></Tijslot_van>
<Tijslot_tm></Tijslot_tm>
<Portbase_code>${locatie1.portbase || ''}</Portbase_code>
<bicsCode>${locatie1.bics || ''}</bicsCode>
</Locatie>
<Locatie>
<Volgorde>0</Volgorde>
<Actie>Rijden</Actie>
<Naam>${naam2}</Naam>
<Adres></Adres>
<Postcode></Postcode>
<Plaats></Plaats>
<Land>NL</Land>
</Locatie>
<Locatie>
<Volgorde>0</Volgorde>
<Actie>Inleveren</Actie>
<Naam>${naam3}</Naam>
<Adres>${locatie3.adres || ''}</Adres>
<Postcode>${locatie3.postcode || ''}</Postcode>
<Plaats>${locatie3.plaats || ''}</Plaats>
<Land>${locatie3.land || 'NL'}</Land>
<Voorgemeld>${locatie3.voorgemeld || ''}</Voorgemeld>
<Aankomst_verw></Aankomst_verw>
<Tijslot_van></Tijslot_van>
<Tijslot_tm></Tijslot_tm>
<Portbase_code>${locatie3.portbase || ''}</Portbase_code>
<bicsCode>${locatie3.bics || ''}</bicsCode>
</Locatie>
</Locaties>
<Financieel>
<Tarief></Tarief>
<BTW>21</BTW>
</Financieel>
</Dossier>
</Dossiers>
</Order>`;

  return xml;
}
