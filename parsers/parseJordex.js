import fs from 'fs';
// Blokkeer toegang tot testbestand van pdf-parse
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from(''); // Leeg buffer retourneert niets
  }
  return originalReadFileSync.call(this, path, ...args);
};
import pdfParse from 'pdf-parse';

    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text;

    // ❗ Sla test-bestanden zoals '05-versions-space.pdf' over
    if (text.includes('05-versions-space')) {
      console.warn('⚠️ Skipping test file: 05-versions-space.pdf');
      return {};
    }

    const getMatch = (regex, label) => {
      const match = text.match(regex);
      if (!match || !match[1]) console.warn(`⚠️ ${label} NIET gevonden in PDF`);
      return match?.[1]?.trim() || '';
    };

    const opdrachtgeverNaam = getMatch(/Opdrachtgever:\s*(.*)/i, 'opdrachtgeverNaam');
    const referentie = getMatch(/Reference\(s\):\s*(\d+)/i, 'referentie');
    const bootnaam = getMatch(/Vessel:\s*(.*)/i, 'bootnaam');
    const rederij = getMatch(/Carrier:\s*(.*)/i, 'rederij');
    const containertype = getMatch(/1\s+X\s+(\d{2})[\'’]?[\s\-]+high\s+cube\s+reefer/i, 'containertype');
    const temperatuur = getMatch(/Temperature:\s*(-?\d+)/i, 'temperatuur');
    const datumTijd = getMatch(/Date:\s*(\d{2}\s+\w+\s+\d{4})\s+(\d{2}:\d{2})/i, 'datum + tijd');
    const containernummer = getMatch(/Reference\(s\):\s*(\d{8,})/i, 'containernummer');

    const opdrachtgeverAdres = getMatch(/Address:\s*([\w\s\.\-']+\n[^\n]+)/i, 'opdrachtgeverAdres');
    const opdrachtgeverPostcode = getMatch(/(\d{4}\s?[A-Z]{2})/i, 'opdrachtgeverPostcode');
    const opdrachtgeverPlaats = getMatch(/\n(\w{3,})$/im, 'opdrachtgeverPlaats');

    const logOntbrekend = [];
    const checkVeld = (label, value) => { if (!value) logOntbrekend.push(label); return value || ''; };

    const result = {
      opdrachtgeverNaam: checkVeld('opdrachtgeverNaam', opdrachtgeverNaam),
      opdrachtgeverAdres: checkVeld('opdrachtgeverAdres', opdrachtgeverAdres),
      opdrachtgeverPostcode: checkVeld('opdrachtgeverPostcode', opdrachtgeverPostcode),
      opdrachtgeverPlaats: checkVeld('opdrachtgeverPlaats', opdrachtgeverPlaats),
      opdrachtgeverTelefoon: '',
      opdrachtgeverEmail: '',
      opdrachtgeverBTW: '',
      opdrachtgeverKVK: '',
      ritnummer: '',
      ladenOfLossen: '',
      type: '',
      datum: datumTijd.split(' ')[0] || '',
      tijdVan: datumTijd.split(' ')[1] || '',
      tijdTM: '',
      containernummer: checkVeld('containernummer', containernummer),
      containertype: checkVeld('containertype', containertype),
      lading: '',
      adr: '',
      tarra: '',
      geladenGewicht: '',
      brutogewicht: '',
      colli: '',
      zegel: '',
      temperatuur: checkVeld('temperatuur', temperatuur),
      cbm: '',
      brix: '',
      referentie: checkVeld('referentie', referentie),
      bootnaam: checkVeld('bootnaam', bootnaam),
      rederij: checkVeld('rederij', rederij),
      documentatie: '',
      tar: '',
      laadreferentie: '',
      meldtijd: '',
      inleverreferentie: '',
      inleverBootnaam: '',
      inleverBestemming: '',
      inleverRederij: '',
      inleverTAR: '',
      closingDatum: '',
      closingTijd: '',
      instructies: '',
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

    if (logOntbrekend.length > 0) {
      console.warn('⚠️ Ontbrekende velden in Jordex-parser:', logOntbrekend.join(', '));
    }

    return result;

  } catch (err) {
    console.error('❌ Fout in parseJordex:', err.message);
    throw err;
  }
}
