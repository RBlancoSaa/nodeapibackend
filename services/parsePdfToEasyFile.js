// parsePdfToEasyFile.js

import '../utils/fsPatch.js'; // ⛔️ Blokkeer testbestand vóór pdf-parse geladen wordt
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import parseJordex from '../parsers/parseJordex.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function parsePdfToEasyFile(pdfBuffer) {
  console.log('📥 Start parsePdfToEasyFile...');

  const parsedData = await parseJordex(pdfBuffer);
  console.log('📄 Parsed Jordex data:', parsedData);

  const result = {
    opdrachtgeverNaam: parsedData.klantnaam,
    opdrachtgeverAdres: parsedData.klantadres,
    opdrachtgeverPostcode: parsedData.klantpostcode,
    opdrachtgeverPlaats: parsedData.klantplaats,
    opdrachtgeverTelefoon: '',
    opdrachtgeverEmail: '',
    opdrachtgeverBTW: '',
    opdrachtgeverKVK: '',

    ritnummer: '',
    ladenOfLossen: '',
    type: '',
    datum: parsedData.datum,
    tijdVan: parsedData.tijd,
    tijdTM: parsedData.tijd,
    containernummer: parsedData.containernummer,
    containertype: parsedData.containertype,
    lading: parsedData.lading,
    adr: parsedData.imo || parsedData.unnr,
    tarra: '',
    geladenGewicht: parsedData.gewicht,
    brutogewicht: parsedData.gewicht,
    colli: parsedData.colli,
    zegel: '',
    temperatuur: parsedData.temperatuur,
    cbm: parsedData.volume,
    brix: parsedData.brix,
    referentie: parsedData.referentie,
    bootnaam: parsedData.bootnaam,
    rederij: parsedData.rederij,
    documentatie: '',
    tar: '',
    laadreferentie: parsedData.laadreferentie,
    meldtijd: '',
    inleverreferentie: parsedData.inleverreferentie,
    inleverBootnaam: '',
    inleverBestemming: parsedData.inleverBestemming,
    inleverRederij: parsedData.rederij,
    inleverTAR: '',
    closingDatum: parsedData.datum,
    closingTijd: parsedData.tijd,
    instructies: '',

    locaties: parsedData.terminal?.locaties || [],

    tarief: '',
    btw: '',
    adrToeslagChart: '',
    adrBedragChart: '',
    botlekChart: '',
    chassishuurChart: '',
    deltaChart: '',
    dieselChart: '',
    euromaxChart: '',
    extraStopChart: '',
    gasMetenChart: '',
    genChart: '',
    handrailChart: '',
    keurenChart: '',
    kilometersChart: '',
    loeverChart: '',
    loodsChart: '',
    mautChart: '',
    mv2Chart: '',
    scannenChart: '',
    tolChart: '',
    blanco1Chart: '',
    blanco1Text: '',
    blanco2Chart: '',
    blanco2Text: ''
  };

  console.log('🧾 Result object voor XML-opbouw:', result);

  const xml = await generateXmlFromJson(result);
  console.log('📦 XML preview:', xml.slice(0, 500));

  return xml;
}