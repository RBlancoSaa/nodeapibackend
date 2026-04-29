// parsers/parseEimskip.js
// Eimskip leveringsopdrachten
// Formaat: email body bevat afleveradres, subject bevat container + datum + tijd
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getAdresboekEntry,
  getContainerTypeCode,
  getKlantData
} from '../utils/lookups/terminalLookup.js';

function normLand(val) {
  const s = (val || '').trim().toUpperCase();
  if (!s) return 'NL';
  if (/^(NEDERLAND|NETHERLANDS|NL)$/.test(s)) return 'NL';
  if (/^(DUITSLAND|GERMANY|DEUTSCHLAND|DE)$/.test(s)) return 'DE';
  if (/^(BELGI[EÈ]|BELGIUM|BE)$/.test(s)) return 'BE';
  if (/^(UNITED KINGDOM|UK|GB)$/.test(s)) return 'GB';
  if (/^(FRANCE|FRANKRIJK|FR)$/.test(s)) return 'FR';
  if (/^(LUXEMBOURG|LUXEMBURG|LU)$/.test(s)) return 'LU';
  if (/^(SPAIN|SPANJE|ES)$/.test(s)) return 'ES';
  if (/^(ITALY|ITALIE|ITALIË|IT)$/.test(s)) return 'IT';
  return s.length === 2 ? s : 'NL';
}

function parseDatum(str) {
  const m = (str || '').match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${parseInt(m[1])}-${parseInt(m[2])}-${yyyy}`;
}

/**
 * Extraheer adresblok uit email body.
 * Trigger: regel die eindigt op ':' en 'leveren' bevat.
 * Daarna: straat, postcode+stad, land.
 */
function extractAdresBlok(lines) {
  // Methode 1: zoek 'leveren in ...:' trigger
  const trigIdx = lines.findIndex(l => l.endsWith(':') && /leveren/i.test(l));
  if (trigIdx >= 0) {
    const adresLines = [];
    for (let i = trigIdx + 1; i < lines.length && adresLines.length < 3; i++) {
      if (lines[i].trim()) adresLines.push(lines[i].trim());
    }
    if (adresLines.length >= 2) {
      return parseAdresLines(adresLines);
    }
  }

  // Methode 2: zoek postcode-patroon (4 cijfers + tekst)
  for (let i = 1; i < lines.length - 1; i++) {
    if (/^\d{4}(\s*[A-Z]{2})?\s+\S/.test(lines[i])) {
      return parseAdresLines([lines[i - 1] || '', lines[i], lines[i + 1] || '']);
    }
  }

  return null;
}

function parseAdresLines([adres, pcStad, landRaw]) {
  const adresTrimmed = (adres || '').trim();

  // NL: 1234 AB STAD of 1234AB STAD
  const pcNL = pcStad.match(/^(\d{4}\s?[A-Z]{2})\s+(.*)/i);
  // BE/DE/FR: 1234 STAD (enkel cijfers)
  const pcBE = pcStad.match(/^(\d{4})\s+(.*)/);

  let postcode = '', plaats = '';
  if (pcNL) { postcode = pcNL[1].trim().toUpperCase(); plaats = pcNL[2].trim(); }
  else if (pcBE) { postcode = pcBE[1].trim(); plaats = pcBE[2].trim(); }
  else { plaats = pcStad.trim(); }

  const land = normLand(landRaw) || 'BE';
  return { adres: adresTrimmed, postcode, plaats, land };
}

export default async function parseEimskip({ bodyText, mailSubject, pdfAttachments = [] }) {
  console.log('🚢 Eimskip parser gestart');
  const lines = (bodyText || '').split('\n').map(l => l.trim()).filter(Boolean);
  console.log('📋 Eimskip body regels:\n', lines.map((r, i) => `[${i}] ${r}`).join('\n'));

  // ── Onderwerp parsing ──────────────────────────────────────────────────────
  const sub = mailSubject || '';

  // "Levering container CAIU7394309 12:00 uur Brussel 30-04-2026"
  const containerMatch  = sub.match(/container\s+([A-Z]{4}\d{7})/i);
  const containernummer = containerMatch ? containerMatch[1].toUpperCase() : '';

  const tijdMatch = sub.match(/(\d{1,2}:\d{2})\s*uur/i);
  const tijd      = tijdMatch ? tijdMatch[1] : '';

  const datumMatch = sub.match(/(\d{2}-\d{2}-\d{4})/);
  const datum      = datumMatch ? parseDatum(datumMatch[1]) : '';

  console.log(`📦 Container: ${containernummer} | Datum: ${datum} | Tijd: ${tijd}`);

  // ── Afleveradres uit body ──────────────────────────────────────────────────
  const adresBlok = extractAdresBlok(lines);
  console.log('📍 Eimskip afleveradres:', adresBlok);

  // ── PDFs doorzoeken voor extra info ───────────────────────────────────────
  let pdfInfo = {
    containertype: '',
    terminal:      '',
    klantnaam:     '',
    referentie:    ''
  };

  for (const att of pdfAttachments) {
    if (!att.buffer || !Buffer.isBuffer(att.buffer)) continue;
    try {
      const { text } = await pdfParse(att.buffer);
      const pls = text.split('\n').map(l => l.trim()).filter(Boolean);
      console.log(`📄 Eimskip PDF "${att.filename}" (${pls.length} regels):\n`,
        pls.slice(0, 50).map((r, i) => `[${i}] ${r}`).join('\n'));

      // Containertype (20FT / 40FT / HC)
      if (!pdfInfo.containertype) {
        const ctLine = pls.find(l => /\b(20|40|45)\s*(ft|hc|high|voet|standard|dry)/i.test(l));
        if (ctLine) pdfInfo.containertype = ctLine.trim();
      }

      // Terminal (Rotterdam)
      if (!pdfInfo.terminal) {
        const termLine = pls.find(l =>
          /\b(ECT|APMT|RST|Euromax|Uniport|Deltaweg|Amazonehaven|Waalhaven|Eimskip.*terminal)\b/i.test(l)
        );
        if (termLine) pdfInfo.terminal = termLine.trim();
      }

      // Referentie / ordernummer
      if (!pdfInfo.referentie) {
        const refLine = pls.find(l => /^(order|opdracht|ref|referentie|job)[^:]*:\s*\S/i.test(l));
        if (refLine) {
          const rm = refLine.match(/:\s*(\S+)/);
          if (rm) pdfInfo.referentie = rm[1].trim();
        }
        // Of simpelweg een lang getal
        if (!pdfInfo.referentie) {
          const numLine = pls.find(l => /^\d{6,}$/.test(l));
          if (numLine) pdfInfo.referentie = numLine.trim();
        }
      }

      // Klantnaam: zoek regel vóór het adres in de PDF
      if (!pdfInfo.klantnaam && adresBlok?.adres) {
        const adresWord = adresBlok.adres.split(/\s+/)[0] || '';
        const adresIdx = pls.findIndex(l => l.toLowerCase().includes(adresWord.toLowerCase()));
        if (adresIdx > 0) {
          const kandidaat = pls[adresIdx - 1] || '';
          if (kandidaat && !/^\d/.test(kandidaat)) pdfInfo.klantnaam = kandidaat.trim();
        }
      }

    } catch (e) {
      console.warn(`⚠️ Kon PDF "${att.filename}" niet parsen:`, e.message);
    }
  }
  console.log('🔍 Eimskip PDF info:', pdfInfo);

  // ── Lookups ────────────────────────────────────────────────────────────────
  const lossenZoekNaam  = pdfInfo.klantnaam || adresBlok?.plaats || '';
  const lossenZoekAdres = adresBlok?.adres  || '';

  const [opdrachtgever, lossenInfo, opzettenInfo, ctCode] = await Promise.all([
    getKlantData('eimskip'),
    adresBlok ? getAdresboekEntry(lossenZoekNaam, null, lossenZoekAdres) : Promise.resolve(null),
    pdfInfo.terminal ? getTerminalInfoMetFallback(pdfInfo.terminal) : Promise.resolve(null),
    pdfInfo.containertype ? getContainerTypeCode(pdfInfo.containertype.toLowerCase()) : Promise.resolve('0')
  ]);

  const lossenAdres = adresBlok || {};
  const klantnaam   = lossenInfo?.naam || pdfInfo.klantnaam || lossenAdres.plaats || '';

  // ── Locaties ───────────────────────────────────────────────────────────────
  const locaties = [];

  if (opzettenInfo) {
    locaties.push({
      volgorde: '0', actie: 'Opzetten',
      naam:     opzettenInfo.naam     || '',
      adres:    opzettenInfo.adres    || '',
      postcode: opzettenInfo.postcode || '',
      plaats:   opzettenInfo.plaats   || '',
      land:     opzettenInfo.land     || 'NL',
      voorgemeld:    opzettenInfo.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar',
      aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
      portbase_code: String(opzettenInfo.portbase_code || ''),
      bicsCode:      String(opzettenInfo.bicsCode      || '')
    });
  }

  locaties.push({
    volgorde:      '0',
    actie:         'Lossen',
    naam:          lossenInfo?.naam     || klantnaam,
    adres:         lossenInfo?.adres    || lossenAdres.adres    || '',
    postcode:      lossenInfo?.postcode || lossenAdres.postcode || '',
    plaats:        lossenInfo?.plaats   || lossenAdres.plaats   || '',
    land:          lossenInfo?.land     || lossenAdres.land     || 'BE',
    aankomst_verw: datum || '',
    tijslot_van:   tijd  || '',
    tijslot_tm:    ''
  });

  return [{
    ritnummer:     pdfInfo.referentie  || '',
    klantnaam,
    klantadres:    lossenInfo?.adres    || lossenAdres.adres    || '',
    klantpostcode: lossenInfo?.postcode || lossenAdres.postcode || '',
    klantplaats:   lossenInfo?.plaats   || lossenAdres.plaats   || '',
    klantland:     lossenInfo?.land     || lossenAdres.land     || 'BE',

    opdrachtgeverNaam:     opdrachtgever?.naam     || 'EIMSKIP',
    opdrachtgeverAdres:    opdrachtgever?.adres    || '',
    opdrachtgeverPostcode: opdrachtgever?.postcode || '',
    opdrachtgeverPlaats:   opdrachtgever?.plaats   || '',
    opdrachtgeverTelefoon: opdrachtgever?.telefoon || '',
    opdrachtgeverEmail:    opdrachtgever?.email    || '',
    opdrachtgeverBTW:      opdrachtgever?.btw      || '',
    opdrachtgeverKVK:      opdrachtgever?.kvk      || '',

    containernummer,
    containertype:     pdfInfo.containertype || '',
    containertypeCode: ctCode || '0',

    datum,
    tijd,
    referentie:        containernummer,
    laadreferentie:    pdfInfo.referentie || '',
    inleverreferentie: '',
    inleverBestemming: '',

    rederij:         'EIMSKIP',
    bootnaam:        '',
    inleverRederij:  '',
    inleverBootnaam: '',

    zegel:          '',
    colli:          '0',
    lading:         '',
    brutogewicht:   '0',
    geladenGewicht: '0',
    cbm:            '0',

    adr:           'Onwaar',
    ladenOfLossen: 'Lossen',
    instructies:   '',
    tar: '', documentatie: '', tarra: '0', brix: '0',

    locaties
  }];
}
