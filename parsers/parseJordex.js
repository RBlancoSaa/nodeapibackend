import pdfParse from 'pdf-parse';

export default async function parseJordex(pdfBuffer) {
  try {
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text;

    // 🧠 Extract basic container data
    const opdrachtgeverNaam = (text.match(/Opdrachtgever:?\s*(.*)/i) || [])[1] || 'Jordex';
    const referentie = (text.match(/Our reference:?\s*(\S+)/i) || [])[1] || '';
    const bootnaam = (text.match(/Vessel:?\s*(.*)/i) || [])[1] || '';
    const rederij = (text.match(/Carrier:?\s*(.*)/i) || [])[1] || '';
    const containertypeRaw = (text.match(/(\d{2}[A-Z]\d)/i) || [])[1] || '';
    const containernummer = (text.match(/Container number:?\s*([A-Z]{4}\d{7})/i) || [])[1] || '';
    const temperatuur = (text.match(/Temperature:?\s*(-?\d+)/i) || [])[1] || '';
    const tarra = (text.match(/Tarra:?\s*(\d+)/i) || [])[1] || '';
    const brutogewicht = (text.match(/Gross weight:?\s*(\d+)/i) || [])[1] || '';
    const cbm = (text.match(/CBM:?\s*(\d+(\.\d+)?)/i) || [])[1] || '';
    const zegel = (text.match(/Seal:?\s*(.*)/i) || [])[1] || '';

    // 📍 Pick-up en Drop-off gegevens
    const laadref = (text.match(/Pick[- ]?up ref.?\s*[:\-]?\s*(.*)/i) || [])[1] || '';
    const pickuploc = (text.match(/Pick[- ]?up:?\s*([\s\S]*?)Drop[- ]?off/i) || [])[1] || '';
    const droploc = (text.match(/Drop[- ]?off:?\s*([\s\S]*?)$/i) || [])[1] || '';

    // 🧹 Clean pick-up en drop-off details
    function extractLocationDetails(block) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      return {
        naam: lines[0] || '',
        adres: lines[1] || '',
        postcode: (lines[2]?.match(/\d{4}\s?[A-Z]{2}/) || [])[0] || '',
        plaats: lines[2]?.replace(/\d{4}\s?[A-Z]{2}/, '').trim() || '',
        land: 'NL',
        actie: '',
        voorgemeld: '',
        aankomst_verw: '',
        tijslot_van: '',
        tijslot_tm: '',
        portbase_code: '',
        bicsCode: ''
      };
    }

    const locatie1 = extractLocationDetails(pickuploc);
    locatie1.actie = 'Laden';

    const locatie2 = extractLocationDetails(droploc);
    locatie2.actie = 'Inleveren';

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
