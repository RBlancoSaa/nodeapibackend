// parsers/parseRitra.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode,
  getRederijNaam,
  normLand,
  cleanFloat
} from '../utils/lookups/terminalLookup.js';

function parseDatum(str) {
  const m = (str || '').match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${parseInt(m[1])}-${parseInt(m[2])}-${yyyy}`;
}

function splitPCPlaats(raw) {
  // "3089 KMROTTERDAM" → { postcode: "3089 KM", plaats: "ROTTERDAM" }
  const m = (raw || '').match(/^(\d{4})\s*([A-Z]{2})\s*(.+)$/i);
  if (m) return { postcode: `${m[1]} ${m[2]}`, plaats: m[3] };
  return { postcode: '', plaats: raw || '' };
}

export default async function parseRitra(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { text } = await pdfParse(buffer);
  const ls = text.split('\n').map(r => r.trim()).filter(Boolean);
  console.log('📋 Ritra regels:\n', ls.map((r, i) => `[${i}] ${r}`).join('\n'));

  // === Ritnummer ===
  const ritnummer = ls.find(l => /Opdracht nr/i.test(l))?.match(/(\d{5,})/)?.[1] || '';

  // === Datum — voorkeur: Leverdatum uit afhaaladres sectie ===
  const leverdatumIdx = ls.findIndex(l => /^Leverdatum$/i.test(l));
  const leverdatum = leverdatumIdx >= 0 ? parseDatum(ls[leverdatumIdx + 1] || '') : '';
  // Neelevat-stijl: "Datum / tijd:" label, waarde op volgende regel
  const datumTijdIdx = ls.findIndex(l => /^Datum\s*\/\s*tijd\s*:?\s*$/i.test(l));
  const datumTijd = datumTijdIdx >= 0 ? parseDatum(ls[datumTijdIdx + 1] || '') : '';
  const etaLine    = ls.find(l => /^\d{2}\/\d{2}\/\d{2}$/.test(l));
  const docDatLine = ls.find(l => /:\d{2}\/\d{2}\/\d{4}/.test(l));
  const datum = leverdatum || datumTijd || parseDatum(etaLine) || parseDatum((docDatLine || '').replace(':', ''));

  // === Container ===
  const cntrLine       = ls.find(l => /[A-Z]{4}\d{7}/.test(l));
  const containernummer = cntrLine?.match(/([A-Z]{4}\d{7})/)?.[1] || '';
  const isHC           = /\bHC\b/.test(cntrLine || '');
  const typeLine       = ls.find(l => /\bft\d{2}\b/i.test(l));
  const sizeNum        = typeLine?.match(/ft(\d{2})|(\d{2})ft/i);
  const size           = sizeNum?.[1] || sizeNum?.[2] || '20';
  const containertype  = size === '40' ? (isHC ? '40ft HC' : '40ft') : `${size}ft`;

  // === Zegel ===
  const zegel = ls.find(l => /sealnummer/i.test(l))?.match(/sealnummer[:\s]*(\d+)/i)?.[1] || '';

  // === Cargo ===
  let lading = '', colli = '0', gewicht = '0', cbm = '0';
  const cargoHdrIdx = ls.findIndex(l => /KindColli|Kind.*Colli/i.test(l));
  if (cargoHdrIdx >= 0) {
    const cargoLine = ls[cargoHdrIdx + 1] || '';
    lading  = cargoLine.replace(/\d[\d,.]*.*$/, '').replace(/PACKAGES?/i, '').trim();
    const wM = cargoLine.match(/(\d+)[,.](\d{3})/);
    if (wM) gewicht = String(Math.round(parseFloat(wM[0].replace(',', '.'))));
    const col = ls[cargoHdrIdx + 2];
    const kg  = ls[cargoHdrIdx + 3];
    const cbmLine = ls[cargoHdrIdx + 4];
    if (/^\d+$/.test(col)) colli = col;
    if (/^\d+$/.test(kg) && parseInt(kg) > 100) gewicht = kg;
    const cbmM = (cbmLine || '').match(/^([\d]+)[,.]?([\d]*)/);
    if (cbmM) cbm = cbmLine.replace(/Totaal.*/i, '').replace(',', '.').trim();
  }

  // === Rederij & Bootnaam ===
  const rederijLabelIdx = ls.findIndex(l => /^Rederij$/i.test(l));
  const schipLabelIdx   = ls.findIndex(l => /^Schip$/i.test(l));

  let rederijCode = '', bootnaam = '';
  // Values appear BEFORE their labels in the merged pdf output
  if (rederijLabelIdx > 0) {
    for (let i = rederijLabelIdx - 1; i >= Math.max(0, rederijLabelIdx - 6); i--) {
      if (/^[A-Z]{3,4}$/.test(ls[i])) { rederijCode = ls[i]; break; }
    }
  }
  if (schipLabelIdx > 0) {
    for (let i = schipLabelIdx - 1; i >= Math.max(0, schipLabelIdx - 8); i--) {
      if (/^[A-Z]{3,}\s+[A-Z]{3,}$/.test(ls[i])) { bootnaam = ls[i]; break; }
    }
  }

  // === Referenties ===
  const notaRef   = ls.find(l => /nota ref/i.test(l))?.match(/:\s*(\d{6,})/)?.[1] || '';
  const reisnrIdx = ls.findIndex(l => /^Reisnr$/i.test(l));
  let releasenr = '';
  if (reisnrIdx >= 0) {
    for (let i = reisnrIdx + 1; i < Math.min(reisnrIdx + 5, ls.length); i++) {
      if (/^\d{6,}$/.test(ls[i])) { releasenr = ls[i]; break; }
    }
  }

  // === Locaties ===
  const afhaalIdx  = ls.findIndex(l => /^Afhaaladres$/i.test(l));
  const afleverIdx = ls.findIndex(l => /^Afleveradres$/i.test(l));

  // Opzetten: terminal/depot vóór afhaaladres
  let opzettenNaam = '', opzettenAdres = '', opzettenPCRaw = '';
  for (let i = Math.max(0, afhaalIdx - 12); i < afhaalIdx; i++) {
    if (/terminal|depot|matrans/i.test(ls[i]) && ls[i].length > 4) {
      opzettenNaam  = ls[i];
      opzettenAdres = ls[i + 1] || '';
      opzettenPCRaw = ls[i + 2] || '';
      break;
    }
  }
  const pcData = splitPCPlaats(opzettenPCRaw);

  // Klant (laden) ─ afhaaladres
  let klantNaam = '', klantAdres = '', klantPC = '', klantLand = '', klantPlaats = '';
  if (afhaalIdx >= 0) {
    const klantLines = [];
    for (let i = afhaalIdx + 1; i < Math.min(afhaalIdx + 10, ls.length); i++) {
      if (ls[i] !== ':' && !/^(Leverdatum|Afleveradres)$/i.test(ls[i])) klantLines.push(ls[i]);
      if (/^(Leverdatum|Afleveradres)$/i.test(ls[i])) break;
    }
    [klantNaam, klantAdres, klantPC, klantLand, klantPlaats] = klantLines;
  }

  // Afzetten: ECT / terminal na afleveradres
  let afzettenNaam = '';
  if (afleverIdx >= 0) {
    for (let i = afleverIdx + 1; i < Math.min(afleverIdx + 20, ls.length); i++) {
      if (/ECT|Euromax|terminal|RWG|APM/i.test(ls[i]) && ls[i].length > 5) {
        afzettenNaam = ls[i].replace(/,\s*$/, '').trim();
        break;
      }
    }
  }
  if (!afzettenNaam) {
    afzettenNaam = (ls.find(l => /ECT.*Terminal|Euromax/i.test(l)) || '').replace(/,.*/, '').trim();
  }

  // Terminal lookups
  const [opzettenInfo, afzettenInfo] = await Promise.all([
    getTerminalInfoMetFallback(opzettenNaam),
    getTerminalInfoMetFallback(afzettenNaam)
  ]);
  if (!opzettenInfo) console.log(`⚠️ Opzet-terminal niet in lijst: "${opzettenNaam}"`);
  if (!afzettenInfo) console.log(`⚠️ Afzet-terminal niet in lijst: "${afzettenNaam}"`);
  const ctCode     = await getContainerTypeCode(containertype);
  const rederijNaam = await getRederijNaam(rederijCode) || rederijCode;

  const locaties = [
    {
      volgorde: '0', actie: 'Opzetten',
      naam:     opzettenInfo?.naam     || opzettenNaam,
      adres:    opzettenInfo?.adres    || opzettenAdres,
      postcode: opzettenInfo?.postcode || pcData.postcode,
      plaats:   opzettenInfo?.plaats   || pcData.plaats,
      land:     normLand(opzettenInfo?.land || 'NL'),
      voorgemeld: opzettenInfo?.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
      aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(opzettenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(opzettenInfo?.bicsCode      || '')
    },
    {
      volgorde: '0', actie: 'Laden',
      naam:     klantNaam,
      adres:    klantAdres,
      postcode: klantPC,
      plaats:   klantPlaats,
      land:     klantLand === 'NEDERLAND' ? 'NL' : (klantLand || 'NL')
    },
    {
      volgorde: '0', actie: 'Afzetten',
      naam:     afzettenInfo?.naam     || afzettenNaam,
      adres:    afzettenInfo?.adres    || '',
      postcode: afzettenInfo?.postcode || '',
      plaats:   afzettenInfo?.plaats   || '',
      land:     normLand(afzettenInfo?.land || 'NL'),
      voorgemeld: afzettenInfo?.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
      aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: cleanFloat(afzettenInfo?.portbase_code || ''),
      bicsCode:      cleanFloat(afzettenInfo?.bicsCode      || '')
    }
  ];

  return [{
    ritnummer,
    klantnaam:    klantNaam,
    klantadres:   klantAdres,
    klantpostcode: klantPC,
    klantplaats:  klantPlaats,

    opdrachtgeverNaam:     'RITRA',
    opdrachtgeverAdres:    'ALBERT PLESMANWEG 61C',
    opdrachtgeverPostcode: '3088 GB',
    opdrachtgeverPlaats:   'ROTTERDAM',
    opdrachtgeverTelefoon: '010-7671000',
    opdrachtgeverEmail:    'info@ritra.nl',
    opdrachtgeverBTW:      'NL007191431B01',
    opdrachtgeverKVK:      '24170187',

    containernummer,
    containertype,
    containertypeCode: ctCode || '0',

    datum,
    tijd: '',
    referentie:        releasenr || notaRef,
    laadreferentie:    notaRef   || '',
    inleverreferentie: '',
    inleverBestemming: '',

    rederij:        rederijNaam || rederijCode,
    bootnaam,
    inleverRederij: rederijNaam || rederijCode,
    inleverBootnaam: bootnaam,

    zegel,
    colli,
    lading,
    brutogewicht:   gewicht,
    geladenGewicht: gewicht,
    cbm,

    adr: 'Onwaar',
    ladenOfLossen: 'Laden',
    instructies: '',
    tar: '', documentatie: '', tarra: '0', brix: '0',

    locaties
  }];
}
