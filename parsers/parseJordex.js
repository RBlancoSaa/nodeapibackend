// parseJordex.js

import '../utils/fsPatch.js'; // ⛔️ Blokkeer testbestand vóór pdf-parse geladen wordt
import pdfParse from 'pdf-parse';
import { supabase } from '../services/supabaseClient.js';
import { getTerminalInfo } from '../helpers/terminalLookup.js';
import { getContainerTypeCode } from '../helpers/containerTypes.js';

export default async function parseJordex(pdfBuffer) {
  console.log('📥 Start parser...');

  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('⚠️ Geen geldig PDF-buffer ontvangen');
    return null;
  }

  const { text } = await pdfParse(pdfBuffer);
  console.log('📎 pdfBuffer lengte:', pdfBuffer.length);
  console.log('🧪 Eerste 100 tekens tekst:', text.slice(0, 100));

  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  const data = {
    referentie: null,
    rederij: null,
    bootnaam: null,
    containertype: null,
    containernummer: null,
    temperatuur: null,
    datum: null,
    tijd: null,
    laadreferentie: null,
    inleverreferentie: null,
    inleverBestemming: null,
    gewicht: null,
    volume: null,
    colli: null,
    lading: null,
    imo: null,
    unnr: null,
    brix: null,
    klantnaam: null,
    klantadres: null,
    klantpostcode: null,
    klantplaats: null
  };

  for (const line of lines) {
    if (line.includes('Our reference:')) data.referentie = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('carrier')) data.rederij = line.split(':').pop().trim();
    if (line.toLowerCase().includes('vessel')) data.bootnaam = line.split(':').pop().trim();
    if (line.toLowerCase().includes('container type')) data.containertype = getContainerTypeCode(line);
    if (line.toLowerCase().includes('container no')) data.containernummer = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('temperature')) data.temperatuur = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('closing')) {
      const parts = line.split(/[: ]+/);
      data.datum = parts[1];
      data.tijd = parts[2];
    }
    if (line.toLowerCase().includes('pick-up reference')) data.laadreferentie = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('drop-off reference')) data.inleverreferentie = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('final destination')) data.inleverBestemming = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('weight')) data.gewicht = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('volume')) data.volume = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('colli')) data.colli = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('description of goods')) data.lading = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('imo')) data.imo = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('un')) data.unnr = line.split(':')[1]?.trim();
    if (line.toLowerCase().includes('brix')) data.brix = line.split(':')[1]?.trim();

    // Klantgegevens (meestal pick-up locatie)
    if (!data.klantnaam && line.toLowerCase().includes('tiaro transport')) data.klantnaam = line;
    if (!data.klantadres && line.toLowerCase().includes('mariniersweg')) data.klantadres = line;
    if (!data.klantpostcode && line.match(/\d{4}[A-Z]{2}/)) data.klantpostcode = line.match(/\d{4}[A-Z]{2}/)[0];
    if (!data.klantplaats && line.toLowerCase().includes('rotterdam')) data.klantplaats = 'Rotterdam';
  }

  Object.entries(data).forEach(([key, value]) => {
    if (!value) {
      console.warn(`⚠️ ${key} NIET gevonden in PDF`);
      data[key] = '0';
    } else {
      console.log(`✅ ${key}:`, value);
    }
  });

  const terminalInfo = await getTerminalInfo(data.referentie, supabase);
  if (terminalInfo) {
    data.terminal = terminalInfo;
    console.log('📦 Terminalinfo opgehaald:', terminalInfo);
  } else {
    console.warn('⚠️ Geen terminalinfo gevonden voor referentie', data.referentie);
  }

  return data;
}
