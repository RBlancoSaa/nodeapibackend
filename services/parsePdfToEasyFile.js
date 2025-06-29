//.parsePdfToEasyFile.js
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

console.log('✅ SUPABASE_URL in parsePdfToEasyFile:', process.env.SUPABASE_URL); // Debug

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ⛔️ Testbestand blokkeren
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parser...');

  const parsedData = await parseJordex(pdfBuffer);
  console.log('📄 Parsed data ontvangen:', parsedData);

  const result = {
    opdrachtgever: parsedData.opdrachtgeverNaam,
    opdrachtgever_adres: parsedData.opdrachtgeverAdres,
    opdrachtgever_postcode: parsedData.opdrachtgeverPostcode,
    opdrachtgever_plaats: parsedData.opdrachtgeverPlaats,
    opdrachtgever_telefoonnummer: parsedData.opdrachtgeverTelefoon,
    opdrachtgever_email: parsedData.opdrachtgeverEmail,
    opdrachtgever_btw: parsedData.opdrachtgeverBTW,
    opdrachtgever_kvk: parsedData.opdrachtgeverKVK,
    laden_lossen: parsedData.ladenOfLossen,
    tijd_van: parsedData.tijdVan,
    tijd_tm: parsedData.tijdTM,
    ritnummer: parsedData.ritnummer,
    type: parsedData.type,
    datum: parsedData.datum,
    containernummer: parsedData.containernummer,
    containertype: parsedData.containertype,
    lading: parsedData.lading,
    adr: parsedData.adr,
    tarra: parsedData.tarra,
    geladenGewicht: parsedData.geladenGewicht,
    brutogewicht: parsedData.brutogewicht,
    colli: parsedData.colli,
    zegel: parsedData.zegel,
    temperatuur: parsedData.temperatuur,
    cbm: parsedData.cbm,
    brix: parsedData.brix,
    referentie: parsedData.referentie,
    bootnaam: parsedData.bootnaam,
    rederij: parsedData.rederij,
    documentatie: parsedData.documentatie,
    tar: parsedData.tar,
    laadreferentie: parsedData.laadreferentie,
    meldtijd: parsedData.meldtijd,
    inleverreferentie: parsedData.inleverreferentie,
    inleverBootnaam: parsedData.inleverBootnaam,
    inleverBestemming: parsedData.inleverBestemming,
    inleverRederij: parsedData.inleverRederij,
    inleverTAR: parsedData.inleverTAR,
    closingDatum: parsedData.closingDatum,
    closingTijd: parsedData.closingTijd,
    instructies: parsedData.instructies,
    locaties: parsedData.locaties,
    tarief: parsedData.tarief,
    btw: parsedData.btw,
    adrToeslagChart: parsedData.adrToeslagChart,
    adrBedragChart: parsedData.adrBedragChart,
    botlekChart: parsedData.botlekChart,
    chassishuurChart: parsedData.chassishuurChart,
    deltaChart: parsedData.deltaChart,
    dieselChart: parsedData.dieselChart,
    euromaxChart: parsedData.euromaxChart,
    extraStopChart: parsedData.extraStopChart,
    gasMetenChart: parsedData.gasMetenChart,
    genChart: parsedData.genChart,
    handrailChart: parsedData.handrailChart,
    keurenChart: parsedData.keurenChart,
    kilometersChart: parsedData.kilometersChart,
    loeverChart: parsedData.loeverChart,
    loodsChart: parsedData.loodsChart,
    mautChart: parsedData.mautChart,
    mv2Chart: parsedData.mv2Chart,
    scannenChart: parsedData.scannenChart,
    tolChart: parsedData.tolChart,
    blanco1Chart: parsedData.blanco1Chart,
    blanco1Text: parsedData.blanco1Text,
    blanco2Chart: parsedData.blanco2Chart,
    blanco2Text: parsedData.blanco2Text,
    ...parsedData
  };

  console.log('🧾 Result object opgebouwd:', result);

  const xml = await generateXmlFromJson(result);
  console.log('📦 XML gegenereerd:', xml.slice(0, 500));

  return xml;
}
