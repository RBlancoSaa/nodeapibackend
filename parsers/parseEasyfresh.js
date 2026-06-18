// parsers/parseEasyfresh.js
// Geport uit AHQ src/lib/harvester/parsers/easyfresh.ts — aangepast aan nodeapi's
// vorm (enrichOrder, DD-MM-YYYY datums, nodeapi-veldnamen).
//
// Easyfresh stuurt PDFs met de structuur:
//   - Header: "Opdrachtbevestiging EFN26-05-0266"
//   - Vracht-sectie: lading + temperatuur ("CITRUS+1,0°C")
//   - Activiteit-sectie met twee regels:
//       1. "... Cont. vol uithal." + datum + opzet-locatie + container + boot/rederij
//       2. "CONTAINER INLEVEREN ..." + datum + afzet-locatie + afzet-referentie
//
// Altijd een import-flow: volle container ophalen bij opzet-terminal en
// inleveren bij afzet-locatie. Geen tussenstop bij klant in dit format.
import '../utils/fsPatch.js';
import { extractPdfText } from '../utils/ocrPdf.js';
import { enrichOrder } from '../utils/enrichOrder.js';

const MAAND_NL = {
  jan: '01', feb: '02', mrt: '03', maa: '03', apr: '04', mei: '05',
  jun: '06', jul: '07', aug: '08', sep: '09', okt: '10', nov: '11', dec: '12',
};

// Geeft DD-MM-YYYY (nodeapi/EasyTrip-formaat).
function parseDatumNL(raw) {
  // "08-mei-2026"
  const m = (raw || '').toLowerCase().match(/(\d{1,2})[-\s]+([a-z]{3,4})[-\s]+(\d{4})/);
  if (m) {
    const maand = MAAND_NL[m[2].slice(0, 3)];
    if (maand) return `${m[1].padStart(2, '0')}-${maand}-${m[3]}`;
  }
  // "19-05-26"
  const num = (raw || '').match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (num) {
    const yyyy = num[3].length === 2 ? '20' + num[3] : num[3];
    return `${num[1].padStart(2, '0')}-${num[2].padStart(2, '0')}-${yyyy}`;
  }
  return '';
}

function formatTijd(t) {
  const m = (t || '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}:00` : '';
}

// Parse "naam, straat 70, 3197 KG Plaats - Wijk, Nederland" → gestructureerd.
function parseAdresUitActiviteit(blok) {
  const delen = (blok || '').split(',').map(s => s.trim()).filter(Boolean);
  const naam = delen[0] || '';
  let adres = '', postcode = '', plaats = '', land = 'NL';
  for (let i = 1; i < delen.length; i++) {
    const pc = delen[i].match(/^(\d{4}\s?[A-Z]{2})\s+(.+)$/i);
    if (pc) {
      postcode = pc[1].replace(/\s+/g, ' ').trim();
      plaats = pc[2].trim();
      adres = delen.slice(1, i).join(', ').trim();
      if (delen[i + 1] && /^(nederland|netherlands|nl|belgium|belgie|be)$/i.test(delen[i + 1])) {
        land = delen[i + 1].toLowerCase().startsWith('be') ? 'BE' : 'NL';
      }
      break;
    }
  }
  if (!postcode && delen[1]) adres = delen[1];
  return { naam: naam.toUpperCase().trim(), adres, postcode, plaats, land };
}

const OPDRACHTGEVER = {
  opdrachtgeverNaam:     'EASYFRESH NEDERLAND BV',
  opdrachtgeverAdres:    'HAZELDONK 6284',
  opdrachtgeverPostcode: '4836 LG',
  opdrachtgeverPlaats:   'BREDA',
  opdrachtgeverTelefoon: '+31 76 5937030',
  opdrachtgeverEmail:    'transport@easyfresh-nederland.com',
  opdrachtgeverBTW:      'NL853925525B01',
  opdrachtgeverKVK:      '60471395',
};

export default async function parseEasyfresh(buffer, alias = 'easyfresh') {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { text, lines: ls } = await extractPdfText(buffer, 'Easyfresh transportopdracht');
  console.log('📋 Easyfresh regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // Klant-referentie: "EFN26-05-0266"
  const klantReferentie = text.match(/(EFN\d{2}-\d{2}-\d{4})/)?.[1] || '';

  // Order-datum (aanvraagdatum, niet uitvoering)
  const datumOrder = parseDatumNL(text.match(/Datum\s+(\d{1,2}-[a-z]{3,4}-\d{4})/i)?.[1] || '');

  // Lading + temperatuur uit de "Vracht"-regel ("CITRUS+1,0°C")
  const vrachtIdx = ls.findIndex(l => /^Vracht$/i.test(l));
  let lading = '', temperatuur = '';
  if (vrachtIdx >= 0 && ls[vrachtIdx + 1]) {
    const reg = ls[vrachtIdx + 1];
    const tempM = reg.match(/^(.+?)([+-]?\s*\d+(?:[.,]\d+)?\s*°?C)\s*$/);
    if (tempM) { lading = tempM[1].trim(); temperatuur = tempM[2].replace(/\s+/g, '').trim(); }
    else lading = reg.trim();
  }

  // Activiteit-regels
  const uithalRegel    = ls.find(l => /Cont(?:ainer)?\.?\s+vol\s+uithal\.?/i.test(l)) || '';
  const inleverenRegel = ls.find(l => /Container\s+vol\s+inleveren/i.test(l)) || '';

  // ── Uithaal-regel: datum + opzet-locatie + container + boot/rederij ──
  let datumUithaal = '', tijdUithaal = '';
  let opzetLoc = { naam: '', adres: '', postcode: '', plaats: '', land: 'NL' };
  let containernummer = '', bootnaam = '', rederijRaw = '';
  if (uithalRegel) {
    const dtM = uithalRegel.match(/^(\d{1,2}-\d{1,2}-\d{2,4})\s+(\d{1,2}:\d{2}):/);
    if (dtM) { datumUithaal = parseDatumNL(dtM[1]); tijdUithaal = formatTijd(dtM[2]); }
    const naActiviteit = uithalRegel.replace(/^\d{1,2}-\d{1,2}-\d{2,4}\s+\d{1,2}:\d{2}:\s*/, '');
    const splitIdx = naActiviteit.search(/Cont(?:ainer)?\.?\s+vol\s+uithal\.?/i);
    const adresDeel = splitIdx > 0 ? naActiviteit.slice(0, splitIdx).replace(/,\s*$/, '') : naActiviteit;
    opzetLoc = parseAdresUitActiviteit(adresDeel);
    const naUithal = splitIdx > 0 ? naActiviteit.slice(splitIdx).replace(/^Cont(?:ainer)?\.?\s+vol\s+uithal\.?/i, '') : '';
    const cMatch = naUithal.match(/([A-Z]{3}[UJZ]\d{7})/);
    if (cMatch) containernummer = cMatch[1];
    const naContainer = naUithal.split(',').slice(1).join(',').trim();
    const slashM = naContainer.match(/^(.+?)\s*\/\s*(.+?)\s*$/);
    if (slashM) { bootnaam = slashM[1].trim(); rederijRaw = slashM[2].trim(); }
    else if (naContainer) bootnaam = naContainer.replace(/\s+/g, ' ').trim();
  }

  // ── Inleveren-regel: datum + afzet-locatie + afzet-referentie ──
  let afzetLoc = { naam: '', adres: '', postcode: '', plaats: '', land: 'NL' };
  let afzetRef = '', bijzonderheden = '';
  if (inleverenRegel) {
    const zonderPrefix = inleverenRegel.replace(/^CONTAINER\s+INLEVEREN/i, '').trim();
    const naActiviteit = zonderPrefix.replace(/^\d{1,2}-\d{1,2}-\d{2,4}\s+\d{1,2}:\d{2}:\s*/, '');
    const splitIdx = naActiviteit.search(/Container\s+vol\s+inleveren/i);
    const adresDeel = splitIdx > 0 ? naActiviteit.slice(0, splitIdx).replace(/,\s*$/, '') : naActiviteit;
    afzetLoc = parseAdresUitActiviteit(adresDeel);
    const naInleveren = splitIdx > 0
      ? naActiviteit.slice(splitIdx).replace(/^Container\s+vol\s+inleveren\s*,?\s*/i, '')
      : '';
    const refDelen = naInleveren.split(',').map(s => s.trim()).filter(Boolean);
    if (refDelen[0]) afzetRef = refDelen[0];
    if (refDelen.length > 1) bijzonderheden = refDelen.slice(1).join(', ');
  }

  // Zonder klant-ref hebben we letterlijk niks — overslaan.
  if (!klantReferentie) {
    console.warn('⚠️ Easyfresh: geen EFN-referentie gevonden — geen order');
    return [];
  }

  const klant = {
    klantnaam:     'TIARO TRANSPORT B.V.',
    klantadres:    'BENEDENRIJWEG 54',
    klantpostcode: '2983 GG',
    klantplaats:   'RIDDERKERK',
  };

  // Fallback: ref gevonden maar uithaal-regel niet (gewijzigd sjabloon) → minimale
  // order zodat de planner 'm ziet, met de eerste 500 chars in instructies.
  if (!uithalRegel) {
    const ruweTekst = (text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    return [await enrichOrder({
      ...OPDRACHTGEVER, ...klant,
      ritnummer: klantReferentie,
      containernummer: '', containertype: '', containertypeCode: '0',
      datum: datumOrder, tijd: '',
      referentie: klantReferentie, laadreferentie: '', inleverreferentie: '',
      inleverBestemming: '',
      rederijRaw: '', rederij: '', bootnaam: '', inleverBootnaam: '', inleverRederij: '',
      zegel: '', colli: '0', lading: (lading || 'CITRUS').toUpperCase(),
      brutogewicht: '0', geladenGewicht: '0', cbm: '0',
      temperatuur: temperatuur || '0',
      adr: 'Onwaar', ladenOfLossen: 'Lossen', _ladenOfLossenFixed: true,
      instructies: `⚠ Easyfresh-parser kon de uithaal-regel niet vinden — handmatig aanvullen (container, terminals, datum). Eerste 500 chars: ${ruweTekst}`,
      tar: '', documentatie: '', tarra: '0', brix: '0',
      locaties: [
        { volgorde: '0', actie: 'Opzetten', naam: '', adres: '', postcode: '', plaats: '', land: 'NL', _noTerminalLookup: true },
        { volgorde: '0', actie: 'Afzetten', naam: '', adres: '', postcode: '', plaats: '', land: 'NL', _noTerminalLookup: true },
      ],
    }, { bron: 'Easyfresh' })];
  }

  const datum = datumUithaal || datumOrder;

  // Locaties: opzet (uithaal) + afzet (inleveren). Terminal→terminal, geen klantstop.
  const locaties = [
    { volgorde: '0', actie: 'Opzetten', naam: opzetLoc.naam, adres: opzetLoc.adres, postcode: opzetLoc.postcode, plaats: opzetLoc.plaats, land: opzetLoc.land },
    { volgorde: '0', actie: 'Afzetten', naam: afzetLoc.naam, adres: afzetLoc.adres, postcode: afzetLoc.postcode, plaats: afzetLoc.plaats, land: afzetLoc.land },
  ];

  const result = await enrichOrder({
    ...OPDRACHTGEVER, ...klant,
    ritnummer: klantReferentie,
    containernummer: containernummer || '',
    containertype: '', containertypeCode: '0',
    datum, tijd: tijdUithaal,
    referentie: containernummer || '',   // container-pickup ref bij opzet
    laadreferentie: '',
    inleverreferentie: afzetRef || '',
    inleverBestemming: '',
    rederijRaw, rederij: '', bootnaam, inleverBootnaam: bootnaam, inleverRederij: '',
    zegel: '', colli: '0', lading: (lading || 'CITRUS').toUpperCase(),
    brutogewicht: '0', geladenGewicht: '0', cbm: '0',
    temperatuur: temperatuur || '0',
    adr: 'Onwaar', ladenOfLossen: 'Lossen', _ladenOfLossenFixed: true,
    instructies: bijzonderheden || '',
    tar: '', documentatie: '', tarra: '0', brix: '0',
    locaties,
  }, { bron: 'Easyfresh' });

  console.log(`✅ parseEasyfresh: ref=${klantReferentie} container=${containernummer || '—'}`);
  return [result];
}
