import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}

function formatDateWithPadding(dateStr) {
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2})/);
  if (!match) return '';
  const [_, mm, dd, yy] = match;
  return `${parseInt(dd)}-${parseInt(mm)}-20${yy}`;
}

export default async function parseEasyfresh(pdfBuffer) {
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

  const data = {
    opdrachtgever_naam: 'Easyfresh Nederland BV',
    opdrachtgever_adres: 'Hazeldonk 6284',
    opdrachtgever_postcode: '4836 LG',
    opdrachtgever_plaats: 'Breda',
    opdrachtgever_telefoon: '+31 76 5937030',
    opdrachtgever_email: 'transport@easyfresh-nederland.com',
    opdrachtgever_btw: 'NL853925525B01',
    opdrachtgever_kvk: '60471395',
  };

  const ritnummer = regels.find(r => r.includes('Opdrachtbevestiging'))?.split(' ').pop() || '';
  logResult('ritnummer', ritnummer);

  const containerLine = regels.find(r => r.match(/Cont\. vol uith\./i));
  const containernummer = containerLine?.match(/([A-Z]{4}\d{7})/)?.[1] || '';
  logResult('containernummer', containernummer);

  const bootnaam = regels.find(r => r.includes('Vaartuig'))?.split('Vaartuig')?.[1]?.split('Reis')[0]?.trim() || '';
  if (!bootnaam) {
    console.warn('⚠️ Geen rederij gevonden, opdracht wordt niet ingelezen.');
    return null;
  }
  logResult('bootnaam', bootnaam);

  const rederij = regels.find(r => r.includes('Rederij'))?.split('Rederij')?.[1]?.trim() || '';
  if (!rederij) {
    console.warn('⚠️ Geen rederij opgegeven – parser beëindigd.');
    return null;
  }
  logResult('rederij', rederij);

  const datumRaw = regels.find(r => r.match(/\d{2}\/\d{2}\/\d{2} 0:00/)) || '';
  const datum = formatDateWithPadding(datumRaw);
  const tijd = '00:00:00';

  const uithaal = regels.find(r => r.toLowerCase().includes('uithal')) || '';
  const inlever = regels.find(r => r.toLowerCase().includes('inleveren')) || '';

  const laadlocatie = await getTerminalInfoMetFallback(uithaal);
  const loslocatie = await getTerminalInfoMetFallback(inlever);

  const inleverreferentie = inlever.match(/Ref:\s*(.+)/i)?.[1]?.trim() || '';
  logResult('inleverreferentie', inleverreferentie);

  const gewichtLine = regels.find(r => r.toLowerCase().includes('gewicht'));
  const gewicht = gewichtLine?.match(/(\d{3,6})/)?.[1] || '10000';
  if (!gewichtLine) {
    console.warn(`⚠️ Gewicht niet gevonden – fallback naar 10000`);
  }

  const containers = [{
    ritnummer,
    containernummer,
    containertype: '45R1',
    containertypeCode: await getContainerTypeCode('45R1'),
    bootnaam,
    rederij,
    datum,
    tijd,
    laadreferentie: '', // geen klant, dus geen laadref
    inleverreferentie,
    gewicht,
    volume: '0',
    temperatuur: '',
    colli: '0',
    brix: '0',
    adr: 'Onwaar',
    locaties: [
      {
        volgorde: '0',
        actie: 'Opzetten',
        naam: laadlocatie?.naam || '',
        adres: laadlocatie?.adres || '',
        postcode: laadlocatie?.postcode || '',
        plaats: laadlocatie?.plaats || '',
        land: laadlocatie?.land || 'NL',
        portbase_code: laadlocatie?.portbase_code || '',
        bicsCode: laadlocatie?.bicsCode || '',
      },
      {
        volgorde: '0',
        actie: 'Afzetten',
        naam: loslocatie?.naam || '',
        adres: loslocatie?.adres || '',
        postcode: loslocatie?.postcode || '',
        plaats: loslocatie?.plaats || '',
        land: loslocatie?.land || 'NL',
        portbase_code: loslocatie?.portbase_code || '',
        bicsCode: loslocatie?.bicsCode || '',
      },
    ]
  }];

  return containers;
}