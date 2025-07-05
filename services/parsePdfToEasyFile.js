// parsePdfToEasyFile.js

import '../utils/fsPatch.js'; // ⛔️ Blokkeer testbestand vóór pdf-parse geladen wordt
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parsePdfToEasyFile...');

const parsedData = await parseJordex(pdfBuffer, 'jordex');
if (!parsedData || typeof parsedData !== 'object') {
  console.warn('⛔️ Geen geldige parserdata ontvangen');
  return ''; // of return null; afhankelijk van je verwerking
}
  console.log('📄 Parsed data ontvangen:', parsedData);

  const result = {
    opdrachtgeverNaam: parsedData.opdrachtgeverNaam || '0',
    opdrachtgeverAdres: parsedData.opdrachtgeverAdres || '0',
    opdrachtgeverPostcode: parsedData.opdrachtgeverPostcode || '0',
    opdrachtgeverPlaats: parsedData.opdrachtgeverPlaats || '0',
    opdrachtgeverTelefoon: parsedData.opdrachtgeverTelefoon || '0',
    opdrachtgeverEmail: parsedData.opdrachtgeverEmail || '0',
    opdrachtgeverBTW: parsedData.opdrachtgeverBTW || '0',
    opdrachtgeverKVK: parsedData.opdrachtgeverKVK || '0',
    ladenOfLossen: parsedData.ladenOfLossen || '0',
    tijdVan: parsedData.tijdVan || '0',
    tijdTM: parsedData.tijdTM || '0',
    ritnummer: parsedData.ritnummer || '0',
    type: parsedData.type || '0',
    datum: parsedData.datum || '0',
    containernummer: parsedData.containernummer || '0',
    containertype: parsedData.containertype || '0',
    lading: parsedData.lading || '0',
    adr: parsedData.adr || '0',
    tarra: parsedData.tarra || '0',
    geladenGewicht: parsedData.geladenGewicht || '0',
    brutogewicht: parsedData.brutogewicht || '0',
    colli: parsedData.colli || '0',
    zegel: parsedData.zegel || '0',
    temperatuur: parsedData.temperatuur || '0',
    cbm: parsedData.cbm || '0',
    brix: parsedData.brix || '0',
    referentie: parsedData.referentie || '0',
    bootnaam: parsedData.bootnaam || '0',
    rederij: parsedData.rederij || '0',
    documentatie: parsedData.documentatie || '0',
    tar: parsedData.tar || '0',
    laadreferentie: parsedData.laadreferentie || '0',
    meldtijd: parsedData.meldtijd || '0',
    inleverreferentie: parsedData.inleverreferentie || '0',
    inleverBootnaam: parsedData.inleverBootnaam || '0',
    inleverBestemming: parsedData.inleverBestemming || '0',
    inleverRederij: parsedData.inleverRederij || '0',
    inleverTAR: parsedData.inleverTAR || '0',
    closingDatum: parsedData.closingDatum || '0',
    closingTijd: parsedData.closingTijd || '0',
    instructies: parsedData.instructies || '0',
    locaties: parsedData.locaties || [],
    tarief: parsedData.tarief || '0',
    btw: parsedData.btw || '0',
    adrToeslagChart: parsedData.adrToeslagChart || '0',
    adrBedragChart: parsedData.adrBedragChart || '0',
    botlekChart: parsedData.botlekChart || '0',
    chassishuurChart: parsedData.chassishuurChart || '0',
    deltaChart: parsedData.deltaChart || '0',
    dieselChart: parsedData.dieselChart || '0',
    euromaxChart: parsedData.euromaxChart || '0',
    extraStopChart: parsedData.extraStopChart || '0',
    gasMetenChart: parsedData.gasMetenChart || '0',
    genChart: parsedData.genChart || '0',
    handrailChart: parsedData.handrailChart || '0',
    keurenChart: parsedData.keurenChart || '0',
    kilometersChart: parsedData.kilometersChart || '0',
    loeverChart: parsedData.loeverChart || '0',
    loodsChart: parsedData.loodsChart || '0',
    mautChart: parsedData.mautChart || '0',
    mv2Chart: parsedData.mv2Chart || '0',
    scannenChart: parsedData.scannenChart || '0',
    tolChart: parsedData.tolChart || '0',
    blanco1Chart: parsedData.blanco1Chart || '0',
    blanco1Text: parsedData.blanco1Text || '0',
    blanco2Chart: parsedData.blanco2Chart || '0',
    blanco2Text: parsedData.blanco2Text || '0',
    klantnaam: parsedData.klantnaam || '0',
    klantadres: parsedData.klantadres || '0',
    klantpostcode: parsedData.klantpostcode || '0',
    klantplaats: parsedData.klantplaats || '0',
    email: parsedData.email || '0',
    telefoon: parsedData.telefoon || '0',
    kvk: parsedData.kvk || '0'
  };

  console.log('🧾 Result object opgebouwd:', result);

  const xml = await generateXmlFromJson(result);
  console.log('📦 XML gegenereerd:', xml.slice(0, 500));

  
  return xml;
}
