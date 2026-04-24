// 📁 parsers/parseSteinweg.js
import '../utils/fsPatch.js';
import XLSX from 'xlsx';
import { getTerminalInfoMetFallback, getContainerTypeCode, getKlantData } from '../utils/lookups/terminalLookup.js';

function parseXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
}

function findHeaderRowIdx(rows) {
  return rows.findIndex(r => r.some(cell => String(cell).trim() === 'Container'));
}

function cellAfterLabel(rows, labelRegex) {
  for (const row of rows) {
    for (let i = 0; i < row.length - 1; i++) {
      if (labelRegex.test(String(row[i]).trim())) {
        for (let j = i + 1; j < row.length; j++) {
          const v = String(row[j]).trim();
          if (v) return v;
        }
      }
    }
  }
  return '';
}

function parseDatum(str) {
  const m = String(str || '').match(/(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}-${yyyy}`;
}

function sizetypeToDescription(sizetype) {
  const s = String(sizetype || '').replace(/\s/g, '');
  if (/^22/.test(s)) return '20ft';
  if (/^42/.test(s)) return '40ft';
  if (/^L[25]/.test(s) || /^45/.test(s)) return '45ft HC';
  if (/^L[04]/.test(s)) return '40ft HC';
  return s;
}

function selectEarliestFutureDatum(datums) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parsed = datums
    .filter(Boolean)
    .map(d => {
      const [dd, mm, yyyy] = String(d).split('-').map(Number);
      return { str: d, date: new Date(yyyy, mm - 1, dd) };
    })
    .filter(d => d.date >= today)
    .sort((a, b) => a.date - b.date);
  return parsed[0]?.str || datums.find(Boolean) || '';
}

function nextSaturday(fromDateStr) {
  let base;
  if (fromDateStr) {
    const [dd, mm, yyyy] = String(fromDateStr).split('-').map(Number);
    base = new Date(yyyy, mm - 1, dd);
  } else {
    base = new Date();
  }
  const daysUntilSat = ((6 - base.getDay()) + 7) % 7 || 7;
  base.setDate(base.getDate() + daysUntilSat);
  const dd = String(base.getDate()).padStart(2, '0');
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${base.getFullYear()}`;
}

function parseOrdernummer(rows) {
  for (const row of rows.slice(0, 5)) {
    for (const cell of row) {
      const v = String(cell).trim();
      if (/^\d{6,}[\/\-]\d/.test(v)) return v.replace('/', '-');
    }
  }
  // Also check for order number in same row as "PICKUP NOTICE"
  for (const row of rows.slice(0, 5)) {
    const idx = row.findIndex(c => /pickup notice/i.test(String(c)));
    if (idx >= 0) {
      for (let j = idx + 1; j < row.length; j++) {
        const v = String(row[j]).trim();
        if (/\d{6,}/.test(v)) return v.replace('/', '-');
      }
    }
  }
  return '';
}

function parseRoute1(buffer) {
  const rows = parseXlsxBuffer(buffer);
  const ordernummer = parseOrdernummer(rows);
  const fromLoc    = cellAfterLabel(rows, /^From\s*:/i).trim();
  const toLoc      = cellAfterLabel(rows, /^To\s*/i).trim();
  const plannedLoading  = parseDatum(cellAfterLabel(rows, /^Planned Loading/i));
  const plannedDelivery = parseDatum(cellAfterLabel(rows, /^Planned Delivery/i));

  const hdrIdx = findHeaderRowIdx(rows);
  if (hdrIdx < 0) return { ordernummer, from: fromLoc, to: toLoc, plannedLoading, plannedDelivery, rederij: '', containers: [] };

  const hdr = rows[hdrIdx].map(h => String(h).trim().toLowerCase());
  const colOf = label => hdr.findIndex(h => h.includes(label.toLowerCase()));

  const cCntr   = colOf('container');
  const cPickup = colOf('pickup ref');
  const cSize   = colOf('sizetype');
  const cWeight = colOf('gross');
  const cProd   = colOf('product');
  const cOrigin = colOf('origin');
  const cImo    = colOf('imo');
  const cZegel  = colOf('zegel');
  const cShip   = colOf('shipping comp');

  let rederij = '';
  const containers = [];

  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const cntr = String(row[cCntr] ?? '').trim();
    if (!cntr || !/^[A-Z]{4}\d{7}$/i.test(cntr)) continue;

    if (!rederij && cShip >= 0) rederij = String(row[cShip] ?? '').trim();

    containers.push({
      containernummer: cntr,
      pickupRef: cPickup >= 0 ? String(row[cPickup] ?? '').trim() : '',
      sizetype:  cSize   >= 0 ? String(row[cSize]   ?? '').trim() : '',
      gewicht:   cWeight >= 0 ? String(row[cWeight] ?? '').trim() : '',
      lading:    cProd   >= 0 ? String(row[cProd]   ?? '').trim() : '',
      origin:    cOrigin >= 0 ? String(row[cOrigin] ?? '').trim() : '',
      imo:       cImo    >= 0 ? String(row[cImo]    ?? '').trim() : '',
      zegel:     cZegel  >= 0 ? String(row[cZegel]  ?? '').trim() : ''
    });
  }

  console.log(`📋 Route 1: ${containers.length} containers | ${fromLoc} → ${toLoc} | datum ${plannedLoading}`);
  return { ordernummer, from: fromLoc, to: toLoc, plannedLoading, plannedDelivery, rederij, containers };
}

function parseRoute2(buffer) {
  const rows = parseXlsxBuffer(buffer);
  const ordernummer = parseOrdernummer(rows);
  const fromLoc    = cellAfterLabel(rows, /^From\s*:/i).trim();
  const toLoc      = cellAfterLabel(rows, /^To\s*/i).trim();
  const plannedLoading  = parseDatum(cellAfterLabel(rows, /^Planned Loading/i));
  const plannedDelivery = parseDatum(cellAfterLabel(rows, /^Planned Delivery/i));

  const hdrIdx = findHeaderRowIdx(rows);
  if (hdrIdx < 0) return { ordernummer, from: fromLoc, to: toLoc, plannedLoading, plannedDelivery, rederij: '', containers: [] };

  const hdr = rows[hdrIdx].map(h => String(h).trim().toLowerCase());
  const colOf = label => hdr.findIndex(h => h.includes(label.toLowerCase()));

  const cCntr   = colOf('container');
  const cRefDel = colOf('re-delivery ref');
  const cDepot  = colOf('return depot');
  const cDest   = colOf('destination');
  const cSize   = colOf('sizetype');
  const cShip   = colOf('shipping comp');

  let rederij = '';
  const containers = [];

  for (let i = hdrIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const cntr = String(row[cCntr] ?? '').trim();
    if (!cntr || !/^[A-Z]{4}\d{7}$/i.test(cntr)) continue;

    if (!rederij && cShip >= 0) rederij = String(row[cShip] ?? '').trim();

    const depotRaw = cDepot >= 0 ? String(row[cDepot] ?? '').trim() : '';
    // "(MEDRSMIR) - Medrepair" → depot naam "Medrepair", code "MEDRSMIR"
    const depotNaam = depotRaw.replace(/^\([^)]+\)\s*-\s*/, '').trim() || depotRaw;

    containers.push({
      containernummer: cntr,
      reDeliveryRef: cRefDel >= 0 ? String(row[cRefDel] ?? '').trim() : '',
      returnDepot:   depotNaam,
      destination:   cDest   >= 0 ? String(row[cDest]   ?? '').trim() : '',
      sizetype:      cSize   >= 0 ? String(row[cSize]   ?? '').trim() : ''
    });
  }

  console.log(`📋 Route 2: ${containers.length} containers | ${fromLoc} → ${toLoc} | datum ${plannedLoading}`);
  return { ordernummer, from: fromLoc, to: toLoc, plannedLoading, plannedDelivery, rederij, containers };
}

export default async function parseSteinweg({ route1Buffer, route2Buffer, emailBody, emailSubject }) {
  const r1 = route1Buffer ? parseRoute1(route1Buffer) : null;
  const r2 = route2Buffer ? parseRoute2(route2Buffer) : null;

  const ordernummer = r1?.ordernummer || r2?.ordernummer || '';
  const rederij     = r1?.rederij    || r2?.rederij    || '';

  const klant = await getKlantData('steinweg');
  const instructies = [emailSubject, emailBody]
    .map(s => (s || '').trim())
    .filter(Boolean)
    .join('\n');

  const results = [];

  if (r1 && r1.containers.length > 0) {
    // Route 1: Opzetten (ECT/from) → Lossen (Steinweg/to)
    const [ectInfo, steinwegInfo] = await Promise.all([
      getTerminalInfoMetFallback(r1.from),
      getTerminalInfoMetFallback(r1.to)
    ]);

    const r1Datum = selectEarliestFutureDatum([r1.plannedLoading, r1.plannedDelivery]);

    for (const c1 of r1.containers) {
      const c2 = r2?.containers.find(c => c.containernummer === c1.containernummer);

      const datum = r1Datum;
      const containerTypeStr = sizetypeToDescription(c1.sizetype || '2210');
      const ctCode = await getContainerTypeCode(containerTypeStr);
      const gewicht = String(Math.round(parseFloat(c1.gewicht) || 0));

      let afzettenLoc = { naam: '', adres: '', postcode: '', plaats: '', land: 'NL', portbase_code: '', bicsCode: '' };
      if (c2) {
        const depotInfo = await getTerminalInfoMetFallback(c2.returnDepot || c2.destination);
        afzettenLoc = {
          naam:         depotInfo.naam      || c2.returnDepot || '',
          adres:        depotInfo.adres     || '',
          postcode:     depotInfo.postcode  || '',
          plaats:       depotInfo.plaats    || '',
          land:         depotInfo.land      || 'NL',
          portbase_code: depotInfo.portbase_code || '',
          bicsCode:     depotInfo.bicsCode  || ''
        };
      }

      const locaties = [
        {
          volgorde: '0', actie: 'Opzetten',
          naam:         ectInfo.naam     || r1.from,
          adres:        ectInfo.adres    || '',
          postcode:     ectInfo.postcode || '',
          plaats:       ectInfo.plaats   || '',
          land:         ectInfo.land     || 'NL',
          voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
          portbase_code: ectInfo.portbase_code || '',
          bicsCode:     ectInfo.bicsCode || ''
        },
        {
          volgorde: '0', actie: 'Lossen',
          naam:         steinwegInfo.naam     || r1.to,
          adres:        steinwegInfo.adres    || '',
          postcode:     steinwegInfo.postcode || '',
          plaats:       steinwegInfo.plaats   || '',
          land:         steinwegInfo.land     || 'NL',
          portbase_code: steinwegInfo.portbase_code || '',
          bicsCode:     steinwegInfo.bicsCode || ''
        },
        {
          volgorde: '0', actie: 'Afzetten',
          naam:         afzettenLoc.naam,
          adres:        afzettenLoc.adres,
          postcode:     afzettenLoc.postcode,
          plaats:       afzettenLoc.plaats,
          land:         afzettenLoc.land,
          voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
          portbase_code: afzettenLoc.portbase_code,
          bicsCode:     afzettenLoc.bicsCode
        }
      ];

      results.push({
        opdrachtgeverNaam:     klant.naam     || 'STEINWEG',
        opdrachtgeverAdres:    klant.adres    || '',
        opdrachtgeverPostcode: klant.postcode || '',
        opdrachtgeverPlaats:   klant.plaats   || '',
        opdrachtgeverTelefoon: klant.telefoon || '',
        opdrachtgeverEmail:    klant.email    || '',
        opdrachtgeverBTW:      klant.btw      || '',
        opdrachtgeverKVK:      klant.kvk      || '',

        klantnaam:     klant.naam     || 'STEINWEG',
        klantadres:    klant.adres    || '',
        klantpostcode: klant.postcode || '',
        klantplaats:   klant.plaats   || '',

        ritnummer:      ordernummer,
        bootnaam:       '',
        rederij,
        inleverBootnaam: '',
        inleverRederij:  rederij,

        containernummer:   c1.containernummer,
        containertype:     containerTypeStr,
        containertypeCode: ctCode || '0',

        zegel:          c1.zegel   || '',
        colli:          '0',
        lading:         (c1.lading || '').toUpperCase(),
        brutogewicht:   gewicht,
        geladenGewicht: gewicht,
        cbm:            '0',

        datum,
        tijd: '',
        referentie:       c1.pickupRef || '',
        laadreferentie:   '',
        inleverreferentie: c2?.reDeliveryRef || '',
        inleverBestemming: c2?.returnDepot   || '',

        adr:           c1.imo && c1.imo !== '' ? 'Waar' : 'Onwaar',
        ladenOfLossen: 'Lossen',
        instructies,
        tar: '', documentatie: '', tarra: '0', brix: '0',
        locaties
      });
    }
  } else if (r2 && r2.containers.length > 0) {
    // Route 2 only: Opzetten (Steinweg) → Afzetten (return depot)
    const [steinwegInfo] = await Promise.all([
      getTerminalInfoMetFallback(r2.from)
    ]);

    const r2Datum = selectEarliestFutureDatum([r2.plannedLoading, r2.plannedDelivery]);

    for (const c2 of r2.containers) {
      const datum = r2Datum;
      const containerTypeStr = sizetypeToDescription(c2.sizetype || '2210');
      const ctCode = await getContainerTypeCode(containerTypeStr);
      const depotInfo = await getTerminalInfoMetFallback(c2.returnDepot || c2.destination);

      const locaties = [
        {
          volgorde: '0', actie: 'Opzetten',
          naam:     steinwegInfo.naam     || r2.from,
          adres:    steinwegInfo.adres    || '',
          postcode: steinwegInfo.postcode || '',
          plaats:   steinwegInfo.plaats   || '',
          land:     steinwegInfo.land     || 'NL',
          voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
          portbase_code: steinwegInfo.portbase_code || '',
          bicsCode: steinwegInfo.bicsCode || ''
        },
        {
          volgorde: '0', actie: 'Lossen',
          naam: '', adres: '', postcode: '', plaats: '', land: 'NL',
          portbase_code: '', bicsCode: ''
        },
        {
          volgorde: '0', actie: 'Afzetten',
          naam:     depotInfo.naam     || c2.returnDepot || '',
          adres:    depotInfo.adres    || '',
          postcode: depotInfo.postcode || '',
          plaats:   depotInfo.plaats   || '',
          land:     depotInfo.land     || 'NL',
          voorgemeld: 'Onwaar', aankomst_verw: '', tijslot_van: '', tijslot_tm: '',
          portbase_code: depotInfo.portbase_code || '',
          bicsCode: depotInfo.bicsCode || ''
        }
      ];

      results.push({
        opdrachtgeverNaam:     klant.naam     || 'STEINWEG',
        opdrachtgeverAdres:    klant.adres    || '',
        opdrachtgeverPostcode: klant.postcode || '',
        opdrachtgeverPlaats:   klant.plaats   || '',
        opdrachtgeverTelefoon: klant.telefoon || '',
        opdrachtgeverEmail:    klant.email    || '',
        opdrachtgeverBTW:      klant.btw      || '',
        opdrachtgeverKVK:      klant.kvk      || '',

        klantnaam:     klant.naam     || 'STEINWEG',
        klantadres:    klant.adres    || '',
        klantpostcode: klant.postcode || '',
        klantplaats:   klant.plaats   || '',

        ritnummer:      ordernummer,
        bootnaam:       '',
        rederij:        r2.rederij || '',
        inleverBootnaam: '',
        inleverRederij:  r2.rederij || '',

        containernummer:   c2.containernummer,
        containertype:     containerTypeStr,
        containertypeCode: ctCode || '0',

        zegel: '', colli: '0', lading: '',
        brutogewicht: '0', geladenGewicht: '0', cbm: '0',

        datum,
        tijd: '',
        referentie:        '',
        laadreferentie:    '',
        inleverreferentie: c2.reDeliveryRef || '',
        inleverBestemming: c2.returnDepot   || '',

        adr: 'Onwaar',
        ladenOfLossen: 'Lossen',
        instructies,
        tar: '', documentatie: '', tarra: '0', brix: '0',
        locaties
      });
    }
  }

  console.log(`✅ parseSteinweg: ${results.length} container(s)`);
  return results;
}
