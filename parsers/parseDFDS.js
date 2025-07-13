// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';

export default async function parseDFDS(buffer) {
  const data = await pdfParse(buffer);
  const text = data.text;
  const containers = [];
  let ritnummer = '';
  let referentie = '';
  let bootnaam = '';
  let datum = '';
  let tijdvan = '';
  let tijdtm = '';
  let laadplaats = '';
  let inleverreferentie = '';
  let dropoffLocatie = '';

  
  // ⛴ Bootnaam
  const bootMatch = text.match(/Vaartuig\s+(.*?)\s+Reis/i);
  if (bootMatch) bootnaam = bootMatch[1].trim();

  // 📅 Datum
  const dateMatch = text.match(/Pickup PORTBASE\s+(\d{2}-\d{2}-\d{4})/i);
  if (dateMatch) datum = dateMatch[1];

  // ⏰ Tijden
  const timeMatch = text.match(/Lossen\s+\S+\s+(\d{2}:\d{2}) - (\d{2}:\d{2})/);
  if (timeMatch) {
    tijdvan = `${timeMatch[1]}:00`;
    tijdtm = `${timeMatch[2]}:00`;
  }

  // 📦 Containers
  const containerRegex = /([A-Z]{4}\d{7})\s+(\d{2}ft(?: HC)?).*\s+Zegel:\s*(\S+)/g;
  const omschrijvingRegex = /Zegel:\s*\S+\n(.*?)\s+([\d.,]+)\s+kg\s+[\d.,]+\s+m3/g;

  const sealMatches = [...text.matchAll(containerRegex)];
  const descMatches = [...text.matchAll(omschrijvingRegex)];

  for (let i = 0; i < sealMatches.length; i++) {
    const [, nummer, type, seal] = sealMatches[i];
    const [, omschrijvingRaw, gewichtRaw] = descMatches[i] || [];

    const gewicht = gewichtRaw?.replace(',', '.') || '0';
    const colli = '0';
    const volume = '0';
    const omschrijving = omschrijvingRaw?.trim() || '';

    containers.push({
      containernummer: nummer,
      containertype: type.replace('ft', '').trim(),
      sealnummer: seal,
      colli,
      gewicht,
      volume,
      omschrijving,
      bootnaam,
      datum,
      tijdvan,
      tijdtm,
      laadplaats: 'ECT Delta Terminal',
      inleverreferentie: '',
      inleverBestemming: '',
      inleverRederij: '',
      ritnummer: '0', // wordt gegenereerd in generator
      referentie: '0',
      adr: 'Onwaar',
      ladenOfLossen: 'Lossen',
    });
  }

  return {
    ritnummer: extractReferentie(text), // bijv. SFIM2500929
    referentie: extractReferentie(text),
    containers
  };
}

// 📌 hulpfunctie om referentie te vinden
function extractReferentie(text) {
  const match = text.match(/Onze referentie\s+([A-Z0-9]+)/i);
  return match ? match[1].trim() : '0';
}