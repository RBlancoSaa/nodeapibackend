// parsers/parseReservering.js
// Extracts date + klant from a reservation email, returns a minimal container object.

const MAANDEN = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12
};

function extractDatum(text) {
  // DD-MM-YYYY or DD/MM/YYYY
  const m1 = text.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (m1) return `${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}-${m1[3]}`;

  // "15 april 2026"
  const m2 = text.match(/(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})/i);
  if (m2) {
    const maand = MAANDEN[m2[2].toLowerCase()];
    return `${m2[1].padStart(2,'0')}-${String(maand).padStart(2,'0')}-${m2[3]}`;
  }

  return '';
}

function extractKlantnaam(from) {
  // "Naam <email@domain.com>" → "Naam"
  const m = (from || '').match(/^([^<@\n]+?)(?:\s*<|$)/);
  return m?.[1]?.trim() || from || 'RESERVERING';
}

export default function parseReservering({ subject, bodyText, from, date }) {
  const text = `${subject || ''}\n${bodyText || ''}`;

  let datum = extractDatum(text);
  if (!datum && date) {
    const d = new Date(date);
    datum = `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
  }

  const klantnaam = extractKlantnaam(from);
  const instructies = `RESERVERING\n${(subject || '').trim()}`.trim();

  return [{
    ritnummer: '',
    klantnaam,
    klantadres: '',
    klantpostcode: '',
    klantplaats: '',

    opdrachtgeverNaam: klantnaam,
    opdrachtgeverAdres: '',
    opdrachtgeverPostcode: '',
    opdrachtgeverPlaats: '',
    opdrachtgeverTelefoon: '',
    opdrachtgeverEmail: '',
    opdrachtgeverBTW: '',
    opdrachtgeverKVK: '',

    containernummer: '',
    containertype: '20ft',
    containertypeCode: '1',

    datum,
    tijd: '',
    referentie: '',
    laadreferentie: '',
    inleverreferentie: '',
    inleverBestemming: '',

    rederij: '',
    bootnaam: '',
    inleverRederij: '',
    inleverBootnaam: '',

    zegel: '',
    colli: '0',
    lading: '',
    brutogewicht: '0',
    geladenGewicht: '0',
    cbm: '0',
    adr: 'Onwaar',
    ladenOfLossen: 'Laden',

    instructies,
    tar: '',
    documentatie: '',
    tarra: '0',
    brix: '0',

    locaties: [
      {
        volgorde: '0', actie: 'Opzetten',
        naam: '', adres: '', postcode: '', plaats: '', land: 'NL',
        voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
        portbase_code: '', bicsCode: ''
      },
      {
        volgorde: '0', actie: 'Lossen',
        naam: klantnaam, adres: '', postcode: '', plaats: '', land: 'NL'
      },
      {
        volgorde: '0', actie: 'Afzetten',
        naam: '', adres: '', postcode: '', plaats: '', land: 'NL',
        voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
        portbase_code: '', bicsCode: ''
      }
    ]
  }];
}
