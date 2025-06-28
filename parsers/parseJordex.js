// 📁 parsers/parseJordex.js

export default async function parseJordex(pdfBuffer) {
  try {
    if (!pdfBuffer || Buffer.isBuffer(pdfBuffer) === false) {
  console.warn("⚠️ Geen geldig PDF-buffer ontvangen");
  return {};
    }
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text;

    const logIfMissing = (label, value) => {
      if (!value) console.warn(`⚠️ ${label} NIET gevonden in PDF`);
      return value || '';
    };

    // Referentie uit "Our reference"
    const referentie = logIfMissing('Referentie', (text.match(/Our reference:\s*(\S+)/i) || [])[1]);

    // Bootnaam
    const bootnaam = logIfMissing('Bootnaam', (text.match(/Vessel:\s*(.*)/i) || [])[1]);

    // Rederij
    const rederij = logIfMissing('Rederij', (text.match(/Carrier:\s*(.*)/i) || [])[1]);

    // Container type (inclusief 20', 40', reefer enz)
    const containertype = logIfMissing('Containertype', (text.match(/(\d{2})['’]?\s+high\s+cube\s+reefer/i) || [])[0]);

    // Temperatuur (mag ook negatief zijn)
    const temperatuur = logIfMissing('Temperatuur', (text.match(/Temperature:\s*(-?\d+)[°º]?C/i) || [])[1]);

    // ADR (optioneel)
    const adr = (text.match(/IMO:\s*(\S+)/i) || [])[1] || '';

    // Gewicht, tarra, brutogewicht, volume (optioneel)
    const tarra = (text.match(/Tarra:\s*(\d+)/i) || [])[1] || '';
    const brutogewicht = (text.match(/Gross weight:\s*(\d+)/i) || [])[1] || '';
    const geladenGewicht = (text.match(/Net weight:\s*(\d+)/i) || [])[1] || '';
    const cbm = (text.match(/Volume:\s*(\d+(\.\d+)?)/i) || [])[1] || '';

    // Pick-up datum en tijd: dit is de ENIGE geldige datum
    const dateMatch = text.match(/Pick[-\s]?up[\s\S]*?Date:\s*(\d{2} \w{3} \d{4}) (\d{2}:\d{2})/i);
    const datum = logIfMissing('Datum', dateMatch?.[1]);
    const tijdVan = logIfMissing('Tijd van', dateMatch?.[2]);

    // Klantreferentie onder Pick-up → Reference(s):
    const klantrefMatch = text.match(/Pick[-\s]?up[\s\S]*?Reference\(s\):\s*(\S+)/i);
    const laadreferentie = logIfMissing('Laadreferentie', klantrefMatch?.[1]);

    // Klantnaam uit Pick-up blok
    const opdrachtgeverNaam = logIfMissing('Opdrachtgever naam', (text.match(/Pick[-\s]?up[\s\S]*?Address:\s*([\w\s.&'-]+)/i) || [])[1]);


    // 🧾 Teruggeven volledige JSON
    return {
      opdrachtgeverNaam,
      opdrachtgeverAdres: '',
      opdrachtgeverPostcode: '',
      opdrachtgeverPlaats: '',
      opdrachtgeverTelefoon: '',
      opdrachtgeverEmail: '',
      opdrachtgeverBTW: '',
      opdrachtgeverKVK: '',
      ritnummer: referentie,
      ladenOfLossen: 'Laden',
      type: 'import',
      datum: '',
      tijdVan: '',
      tijdTM: '',
      containernummer,
      containertype: containertypeRaw,
      lading: '',
      adr: '',
      tarra,
      geladenGewicht: '',
      brutogewicht,
      colli: '',
      zegel,
      temperatuur,
      cbm,
      brix: '',
      referentie,
      bootnaam,
      rederij,
      documentatie: '',
      tar: '',
      laadreferentie: laadref,
      meldtijd: '',
      inleverreferentie: '',
      inleverBootnaam: '',
      inleverBestemming: '',
      inleverRederij: '',
      inleverTAR: '',
      closingDatum: '',
      closingTijd: '',
      instructies: '',
      locaties: [locatie1, locatie2],
      // Financieel dummy (alles nul tenzij gevonden)
      tarief: '',
      btw: '',
      adrToeslagChart: '0',
      adrBedragChart: '0',
      botlekChart: '0',
      chassishuurChart: '0',
      deltaChart: '0',
      dieselChart: '0',
      euromaxChart: '0',
      extraStopChart: '0',
      gasMetenChart: '0',
      genChart: '0',
      handrailChart: '0',
      keurenChart: '0',
      kilometersChart: '0',
      loeverChart: '0',
      loodsChart: '0',
      mautChart: '0',
      mv2Chart: '0',
      scannenChart: '0',
      tolChart: '0',
      blanco1Chart: '0',
      blanco1Text: '',
      blanco2Chart: '0',
      blanco2Text: ''
    };

  } catch (err) {
    console.error('❌ Fout in parseJordex:', err);
    throw err;
  }
}
