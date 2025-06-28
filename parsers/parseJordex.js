import fs from 'fs';
// ⛔️ Blokkeer testbestand vóór pdf-parse geladen wordt
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function parseJordex(pdfBuffer) {
  try {
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
      console.warn('⚠️ Geen geldig PDF-buffer ontvangen');
      return {};
    }

    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text;

    if (text.includes('05-versions-space')) {
      console.warn('⚠️ Skipping test file: 05-versions-space.pdf');
      return {};
    }

console.log('📄 PDF-Tekst:\n', text);

    const getMatch = (regex, label) => {
      const match = text.match(regex);
      if (!match || !match[1]) console.warn(`⚠️ ${label} NIET gevonden in PDF`);
      else console.log(`✅ ${label}:`, match[1].trim());
      return match?.[1]?.trim() || '';
    };

    const logOntbrekend = [];
    const checkVeld = (label, value) => {
      if (!value) logOntbrekend.push(label);
      return value || '';
    };

    // 📄 Basisvelden uit PDF
    const opdrachtgeverNaam = 'Jordex Shipping & Forwarding B.V.';
    const opdrachtgeverAdres = 'Ambachtsweg 6';
    const opdrachtgeverPostcode = '3161 GL';
    const opdrachtgeverPlaats = 'Rhoon';

    const referentie = getMatch(/Our reference:\s*(\S+)/i, 'referentie');
    const bootnaam = getMatch(/Vessel:\s*(.*)/i, 'bootnaam');
    const rederijNaam = getMatch(/Carrier:\s*(.*)/i, 'rederij');
    const containertypeLabel = getMatch(/Cargo:\s*\d+\s*x\s*(.+)/i, 'containertype label');
    const containernummer = getMatch(/([A-Z]{3}U\d{7})/i, 'containernummer');
    const temperatuur = getMatch(/Temperature:\s*(-?\d+)/i, 'temperatuur');
    const datumTijd = getMatch(/Date:\s*(\d{2} \w{3} \d{4})\s+(\d{2}:\d{2})/i, 'datum + tijd');
    const closingDatum = getMatch(/Document closing:\s*(\d{2} \w{3} \d{4})/i, 'closingDatum');
    const closingTijd = getMatch(/VGM closing:\s*\d{2} \w{3} \d{4}\s+(\d{2}:\d{2})/i, 'closingTijd');
    const laadreferentie = getMatch(/Pick-up[\s\S]*?Reference\(s\):\s*(\d+)/i, 'laadreferentie');
    const inleverreferentie = getMatch(/Drop-off terminal[\s\S]*?Reference\(s\):\s*(\d+)/i, 'inleverreferentie');
    const gewicht = getMatch(/Weight\s+(\d+)/i, 'gewicht');
    const volume = getMatch(/Volume\s+(\d+)/i, 'volume');
    const colli = getMatch(/Colli\s+(\d+)/i, 'colli');
    const lading = getMatch(/Description\s+([A-Z\s]+)/i, 'lading');
    const inleverBestemming = getMatch(/To:\s*(.+)/i, 'inleverBestemming');

    const datum = datumTijd.split(' ')[0] || '';
    const tijdVan = datumTijd.split(' ')[1] || '';

    // 📦 Supabase lookups
    const { data: rederijenFile } = await supabase.storage.from('referentielijsten').download('rederijen.json');
    const rederijenJson = JSON.parse(await rederijenFile.text());
    const rederijData = rederijenJson.find(r => r.naam?.toUpperCase() === rederijNaam?.toUpperCase());

    const rederij = rederijData?.naam || '';
    const bicsCode = rederijData?.bicsCode || '';
    const portbaseCode = rederijData?.Portbase_code || '';
    const voorgemeld = rederijData?.Voorgemeld || '';

    const { data: containersFile } = await supabase.storage.from('referentielijsten').download('containertypes.json');
    const containersJson = JSON.parse(await containersFile.text());
    const containerType = containersJson.find(c => containertypeLabel.toLowerCase().includes(c.label.toLowerCase()));
    const containertype = containerType?.code || '';

    const { data: terminalsFile } = await supabase.storage.from('referentielijsten').download('terminals.json');
    const terminals = JSON.parse(await terminalsFile.text());

    const uithaalTerminalText = getMatch(/Pick-up terminal\s*Address:\s*([\s\S]*?)Cargo:/i, 'uithaalTerminal');
    const inleverTerminalText = getMatch(/Drop-off terminal\s*Address:\s*([\s\S]*?)Cargo:/i, 'inleverTerminal');

    const locatie2Terminal = terminals.find(t =>
      uithaalTerminalText?.toLowerCase().includes(t.naam.toLowerCase())
    );
    const locatie3Terminal = terminals.find(t =>
      inleverTerminalText?.toLowerCase().includes(t.naam.toLowerCase())
    );

    // 📍 Klantlocatie
    const klantAdresBlok = getMatch(/Pick-up\s*Address:\s*([\s\S]*?)Cargo:/i, 'klantAdres');
    const klantregels = klantAdresBlok?.split('\n').map(r => r.trim()).filter(Boolean) || [];
    const klantNaam = klantregels[0] || '';
    const klantAdres = klantregels[1] || '';
    const klantPostcodePlaats = klantregels[2] || '';
    const [klantPostcode, ...klantPlaatsDelen] = klantPostcodePlaats.split(' ');
    const klantPlaats = klantPlaatsDelen.join(' ');

    // 📌 Locaties
    const locaties = [
      {
        actie: 'Laden',
        naam: klantNaam,
        adres: klantAdres,
        postcode: klantPostcode,
        plaats: klantPlaats,
        land: 'NL',
        voorgemeld: '',
        aankomst_verw: '',
        tijslot_van: '',
        tijslot_tm: '',
        portbase_code: '',
        bicsCode: ''
      },
      {
        actie: 'Opzetten',
        naam: locatie2Terminal?.naam || '',
        adres: locatie2Terminal?.adres || '',
        postcode: locatie2Terminal?.postcode || '',
        plaats: locatie2Terminal?.plaats || '',
        land: 'NL',
        voorgemeld: locatie2Terminal?.Voorgemeld || '',
        aankomst_verw: '',
        tijslot_van: '',
        tijslot_tm: '',
        portbase_code: locatie2Terminal?.Portbase_code || '',
        bicsCode: locatie2Terminal?.bicsCode || ''
      },
      {
        actie: 'Inleveren',
        naam: locatie3Terminal?.naam || '',
        adres: locatie3Terminal?.adres || '',
        postcode: locatie3Terminal?.postcode || '',
        plaats: locatie3Terminal?.plaats || '',
        land: 'NL',
        voorgemeld: locatie3Terminal?.Voorgemeld || '',
        aankomst_verw: '',
        tijslot_van: '',
        tijslot_tm: '',
        portbase_code: locatie3Terminal?.Portbase_code || '',
        bicsCode: locatie3Terminal?.bicsCode || ''
      }
    ];

    const result = {
      opdrachtgeverNaam,
      opdrachtgeverAdres,
      opdrachtgeverPostcode,
      opdrachtgeverPlaats,
      opdrachtgeverTelefoon: '',
      opdrachtgeverEmail: '',
      opdrachtgeverBTW: '',
      opdrachtgeverKVK: '',
      ritnummer: '',
      ladenOfLossen: 'laden',
      type: containertypeLabel,
      datum,
      tijdVan,
      tijdTM: '',
      containernummer,
      containertype,
      lading,
      adr: '',
      tarra: '',
      geladenGewicht: '',
      brutogewicht: gewicht,
      colli,
      zegel: '',
      temperatuur,
      cbm: volume,
      brix: '',
      referentie,
      bootnaam,
      rederij,
      documentatie: '',
      tar: '',
      laadreferentie,
      meldtijd: '',
      inleverreferentie,
      inleverBootnaam: bootnaam,
      inleverBestemming,
      inleverRederij: rederij,
      inleverTAR: '',
      closingDatum,
      closingTijd,
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
      blanco2Text: '',
      locaties
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