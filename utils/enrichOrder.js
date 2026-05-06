/**
 * utils/enrichOrder.js
 *
 * Centrale enrichment-laag die voor ALLE klanten dezelfde dingen doet:
 *  1. Rederij opzoeken uit de officiële lijst (nooit raw)
 *  2. Containertype → ISO-code
 *  3. Opzetten / Afzetten → terminal lookup (portbase_code, bicsCode, voorgemeld)
 *  4. Laden / Lossen / overige tussenliggende stops → adresboek lookup
 *     – Niet gevonden? → automatisch toevoegen aan adresboek.json op Supabase
 *
 * Parsers hoeven ALLEEN ruwe tekst te extraheren.
 * Alle externe lookups staan hier — één plek om te onderhouden.
 *
 * @param {object} order  - Ruwe parser-output (locaties met naam/adres uit PDF)
 * @param {object} opts
 * @param {string} opts.bron  - Naam van de klant/parser voor logging ("DFDS", "B2L", …)
 * @returns {Promise<object>} - Verrijkt order-object
 */

import './fsPatch.js';
import {
  getTerminalInfoMetFallback,
  slaTerminalCacheOp,
  getAdresboekEntry,
  voegAdresboekEntryToe,
  getRederijNaam,
  getContainerTypeCode,
  normLand,
  cleanFloat
} from './lookups/terminalLookup.js';
import { getPrijsafspraken, getDefaultAfspraken } from './getPrijsafspraken.js';

// Acties die een terminal zijn (Opzetten / Afzetten)
const TERMINAL_ACTIES = new Set(['opzetten', 'afzetten']);

export async function enrichOrder(order, { bron = '', klantKey = '' } = {}) {
  const tag = bron ? `[${bron}]` : '';

  // ── 1. Rederij ────────────────────────────────────────────────────────────
  // Gebruik rederijRaw als de parser de ruwe waarde doorgaf,
  // anders de reeds ingevulde rederij opnieuw valideren.
  const rederijInput = order.rederijRaw ?? order.rederij ?? '';
  if (rederijInput) {
    const officieel = await getRederijNaam(rederijInput);
    if (officieel) {
      order.rederij       = officieel;
      order.inleverRederij = officieel;
    } else {
      console.warn(`⚠️ ${tag} Rederij "${rederijInput}" niet gevonden — veld leeggemaakt`);
      order.rederij       = '';
      order.inleverRederij = '';
    }
  }
  // rederijRaw is alleen intern — niet in XML
  delete order.rederijRaw;

  // ── 2. Containertype → ISO-code ──────────────────────────────────────────
  if (!order.containertypeCode || order.containertypeCode === '0') {
    const code = await getContainerTypeCode(order.containertype || '');
    if (code && code !== '0') order.containertypeCode = code;
  }

  // ── 3. Locaties ──────────────────────────────────────────────────────────
  const onbekendeMeldingen = [];

  for (const loc of (order.locaties || [])) {
    const actieKey = (loc.actie || '').toLowerCase();
    const isTerminal = TERMINAL_ACTIES.has(actieKey);

    if (isTerminal) {
      // ── Terminal (Opzetten / Afzetten) ────────────────────────────────

      // _noTerminalLookup: locatie is een Opzetten/Afzetten voor de klant zelf
      // (bijv. Steinweg eigen vestiging), GEEN haventerminal.
      // Sla de terminal-lijst lookup over zodat naam/adres niet overschreven worden.
      if (loc._noTerminalLookup) {
        delete loc._noTerminalLookup;
        loc.portbase_code = '';
        loc.bicsCode      = '';
        loc.voorgemeld    = 'Onwaar';
        loc.land          = normLand(loc.land || 'NL');
      } else {
        const rawNaam  = loc.naam;
        const rawAdres = loc.adres;
        const info = await getTerminalInfoMetFallback(loc.naam, loc.adres);
        if (info) {
          // Cache opslaan: ruwe PDF-naam/adres → officiële terminal
          // (asynchroon, niet wachten — mag falen zonder impact op order)
          slaTerminalCacheOp(rawNaam, rawAdres, info, bron).catch(() => {});

          loc.naam          = info.naam;
          loc.adres         = info.adres         || loc.adres    || '';
          loc.postcode      = info.postcode       || loc.postcode || '';
          loc.plaats        = info.plaats         || loc.plaats   || '';
          loc.land          = normLand(info.land  || loc.land     || 'NL');
          loc.voorgemeld    = info.voorgemeld?.toLowerCase() === 'ja' ? 'Waar' : 'Onwaar';
          loc.portbase_code = cleanFloat(info.portbase_code || '');
          loc.bicsCode      = cleanFloat(info.bicsCode      || '');

          // Veiligheidscheck: terminal gevonden maar zonder portbase-code.
          // Alleen loggen — NIET toevoegen aan instructies (vervuilt het veld voor de klant).
          if (!loc.portbase_code) {
            console.warn(`⚠️ ${tag} ${loc.actie}-terminal "${loc.naam}" heeft geen portbase_code — voormelding niet mogelijk`);
          }
        } else {
          // Niet in lijst: bewaar ruwe PDF-data + meld in bijzonderheden
          loc.portbase_code = loc.portbase_code || '';
          loc.bicsCode      = loc.bicsCode      || '';
          loc.voorgemeld    = loc.voorgemeld    || 'Onwaar';
          loc.land          = normLand(loc.land || 'NL');
          if (loc.naam) {
            onbekendeMeldingen.push(`${loc.actie}-terminal niet in lijst: ${loc.naam}`);
            console.log(`⚠️ ${tag} ${loc.actie}-terminal niet gevonden: "${loc.naam}"`);
          }
        }
      }
    } else {
      // ── Laden / Lossen / overige stops ────────────────────────────────
      const info = await getAdresboekEntry(loc.naam, null, loc.adres);
      if (info) {
        loc.naam     = info.naam;
        loc.adres    = info.adres    || loc.adres    || '';
        loc.postcode = info.postcode || loc.postcode || '';
        loc.plaats   = info.plaats   || loc.plaats   || '';
        loc.land     = normLand(info.land || loc.land || 'NL');
      } else {
        // Niet gevonden → raw PDF-data gebruiken + automatisch toevoegen
        loc.land = normLand(loc.land || 'NL');
        if (loc.naam && loc.adres) {
          await voegAdresboekEntryToe({
            naam:     loc.naam,
            adres:    loc.adres,
            postcode: loc.postcode || '',
            plaats:   loc.plaats   || '',
            land:     loc.land     || 'NL',
            type:     'Klant',
            bron:     `${bron} auto`
          });
        } else if (loc.naam) {
          console.log(`⚠️ ${tag} Laden/Lossen locatie "${loc.naam}" niet in adresboek (geen adres beschikbaar)`);
        }
      }
    }
  }

  // Onbekende terminals toevoegen aan bijzonderheden
  if (onbekendeMeldingen.length > 0) {
    const melding = onbekendeMeldingen.join(' | ');
    order.instructies = order.instructies
      ? `${order.instructies} | ${melding}`
      : melding;
  }

  // Gasmeten / wegen: ALTIJD prominent vooraan in instructies voor ALLE parsers
  if (order.gasmeten === 'Waar') {
    const al = (order.instructies || '').toUpperCase();
    if (!al.includes('GASMETEN') && !al.includes('WEGEN')) {
      order.instructies = '⚠️ GASMETEN / WEGEN'
        + (order.instructies ? ' | ' + order.instructies : '');
    }
  }

  // ── Universele laden/lossen correctie ────────────────────────────────────────
  // Container bekend → 99% Lossen (import, afleveradres)
  // Geen container  → 99% Laden  (export, ophaaladres)
  // Parsers die dit bewust anders zetten gebruiken _ladenOfLossenFixed: true
  if (!order._ladenOfLossenFixed) {
    const correcteActie = order.containernummer ? 'Lossen' : 'Laden';
    order.ladenOfLossen = correcteActie;
    // Corrigeer ook de klantlocatie actie (niet Opzetten/Afzetten/OMRIJDER)
    for (const loc of (order.locaties || [])) {
      const a = (loc.actie || '').toLowerCase();
      if ((a === 'laden' || a === 'lossen') && (loc.naam || '').toUpperCase() !== 'OMRIJDER') {
        loc.actie = correcteActie;
      }
    }
  }
  delete order._ladenOfLossenFixed;

  // Synchroniseer InleverBestemming vanuit de Afzetten locatie (ná terminal lookup)
  // zodat InleverBestemming en Afzetten locatienaam altijd overeenkomen.
  // _inleverBestemmingFixed: parser heeft bewust een bestemming ingevuld (bijv. PORT OF DISCHARGE "DURBAN")
  // die NIET overschreven mag worden door de terminalnaam.
  if (order.inleverBestemming !== undefined && !order._inleverBestemmingFixed) {
    const afzettenLoc = (order.locaties || []).find(l => (l.actie || '').toLowerCase() === 'afzetten');
    if (afzettenLoc?.naam) order.inleverBestemming = afzettenLoc.naam;
  }
  delete order._inleverBestemmingFixed;

  // Synchroniseer klantnaam/klantadres/etc vanuit de eerste Laden/Lossen locatie
  // (nadat enrichment de naam mogelijk heeft bijgewerkt vanuit het adresboek)
  // Zoek eerste niet-terminal locatie; sla OMRIJDER-placeholder over
  const klantLoc = order.locaties?.find(l =>
    !TERMINAL_ACTIES.has((l.actie || '').toLowerCase()) &&
    (l.naam || '').toUpperCase() !== 'OMRIJDER'
  );
  if (klantLoc) {
    if (order.klantnaam     !== undefined) order.klantnaam     = klantLoc.naam     || order.klantnaam;
    if (order.klantadres    !== undefined) order.klantadres    = klantLoc.adres    || order.klantadres;
    if (order.klantpostcode !== undefined) order.klantpostcode = klantLoc.postcode || order.klantpostcode;
    if (order.klantplaats   !== undefined) order.klantplaats   = klantLoc.plaats   || order.klantplaats;
  }

  // ── 5. Toeslagen (ADR, genset, gasmeten, extra stop) ─────────────────────
  // Alleen berekenen als de parser ze nog niet zelf heeft ingevuld.
  // Parsers die al specifiekere kennis hebben (bijv. Steinweg) zetten deze
  // velden zelf; enrichOrder vult ze dan NIET opnieuw in.
  if (order.adrBedragChart === undefined) {
    try {
      // Twee-staps lookup:
      // 1. klantKey (expliciet, bijv. Steinweg) of klantnaam (per-klant override)
      // 2. bron (opdrachtgever-niveau, bijv. 'eimskip') als fallback
      // getPrijsafspraken geeft null terug als er geen DB-entry is → dan proberen we bron
      const klantNaamKey = (klantKey || (order.klantnaam || '')).toLowerCase().trim();
      let afspraken = klantNaamKey ? await getPrijsafspraken(klantNaamKey) : null;
      if (!afspraken && bron) afspraken = await getPrijsafspraken(bron.toLowerCase().trim());
      // Nog steeds null → gebruik standaard-toeslagen als basis
      if (!afspraken) afspraken = getDefaultAfspraken();

      // Vul basistarief uit prijsafspraken als de parser het niet heeft gezet
      if (!parseFloat(order.tarief) && afspraken) {
        const baseTarief = afspraken.velden?.tarief?.chart ?? 0;
        if (baseTarief > 0) order.tarief = baseTarief;
      }

      // Per-bestemming tarief overschrijft basistarief — match op klantnaam of klantplaats
      if (afspraken?.velden?._tarieven?.length && (order.klantplaats || order.klantnaam)) {
        const plaatsLower = (order.klantplaats || '').toLowerCase().trim();
        const naamLower   = (order.klantnaam   || '').toLowerCase().trim();
        const btMatch = afspraken.velden._tarieven.find(t => {
          const tNaam  = (t.naam  || '').toLowerCase().trim();
          const tPlaats = (t.plaats || '').toLowerCase().trim();
          if (tNaam  && naamLower  && tNaam  === naamLower)  return true;
          if (tPlaats && plaatsLower && tPlaats === plaatsLower) return true;
          return false;
        });
        if (btMatch?.tarief > 0) {
          order.tarief = btMatch.tarief;
          console.log(`${tag} Per-bestemming tarief voor "${order.klantnaam}/${order.klantplaats}": €${btMatch.tarief}`);
        }
      }

      const tarief     = parseFloat(order.tarief) || 0;

      // Terminal toeslagen — detecteer op basis van de (al opgezochte) terminalnamen
      // Eén Opzetten/Afzetten bij ECT Delta → delta toeslag
      // Beide bij ECT Delta (bijv. Eimskip: opzet + afzet zelfde terminal) → 2× delta
      const terminalNamen = (order.locaties || [])
        .filter(l => TERMINAL_ACTIES.has((l.actie || '').toLowerCase()) && (l.naam || ''))
        .map(l => (l.naam || '').toLowerCase());

      const deltaCount   = terminalNamen.filter(n => /\bect\b.*\bdelta\b|\bdelta\b.*\bect\b/i.test(n) || /ect\s*delta/i.test(n)).length;
      const euromaxCount = terminalNamen.filter(n => /euromax/i.test(n)).length;
      const rwgCount     = terminalNamen.filter(n => /\brwg\b/i.test(n)).length;
      const botlekCount  = terminalNamen.filter(n => /botlek/i.test(n) && !/ect|delta|euromax|rwg/i.test(n)).length;
      const hpdCount     = terminalNamen.filter(n => /\bhpd\b/i.test(n) || /hutchison.*delta/i.test(n)).length;
      const apmCount     = terminalNamen.filter(n => /\bapm\b/i.test(n)).length;

      const eenheidDelta   = afspraken ? afspraken.toeslag('delta')   : 0;
      const eenheidEuromax = afspraken ? afspraken.toeslag('euromax') : 0;
      const eenheidRwg     = afspraken ? afspraken.toeslag('rwg')     : 0;
      const eenheidBotlek  = afspraken ? afspraken.toeslag('botlek')  : 0;
      const eenheidApm     = afspraken ? afspraken.toeslag('apm')     : 0;
      const eenheidHpd     = afspraken ? afspraken.toeslag('hpd')     : 0;

      // HPD2 (Hutchison Ports Delta) → zelfde tariefklasse als ECT Delta (beide €28,50)
      const effectiveDeltaCount = deltaCount + hpdCount;
      order.deltaChart   = effectiveDeltaCount > 0 ? eenheidDelta   * effectiveDeltaCount : 0;
      order.euromaxChart = euromaxCount > 0 ? eenheidEuromax * euromaxCount : 0;
      // APM → MV2_Chart in XML
      order.apmChart     = apmCount > 0 ? eenheidApm * apmCount : 0;
      order.mv2Chart     = order.apmChart;
      // RWG → Blanco1 (bedrag + tekst "RWG TOESLAG") voor alle klanten
      order.rwgChart     = rwgCount > 0 ? eenheidRwg * rwgCount : 0;
      if (rwgCount > 0) {
        order.blanco1Chart = order.rwgChart;
        order.blanco1Text  = 'RWG TOESLAG';
      }
      order.botlekChart  = botlekCount  > 0 ? eenheidBotlek  * botlekCount  : 0;

      if (effectiveDeltaCount > 0) console.log(`${tag} Delta/HPD toeslag: ${effectiveDeltaCount}× €${eenheidDelta} = €${order.deltaChart} (delta=${deltaCount}, hpd=${hpdCount})`);
      if (euromaxCount > 0) console.log(`${tag} Euromax toeslag: ${euromaxCount}× €${eenheidEuromax} = €${order.euromaxChart}`);
      if (rwgCount > 0)     console.log(`${tag} RWG toeslag: ${rwgCount}× €${eenheidRwg} → Blanco1 €${order.rwgChart}`);
      if (apmCount > 0)     console.log(`${tag} APM toeslag: ${apmCount}× €${eenheidApm} = €${order.apmChart} (MV2_Chart)`);

      // ADR
      const heeftAdr   = order.adr === 'Waar';
      order.adrToeslagChart = heeftAdr && afspraken ? afspraken.toeslag('adr')         : 0;
      order.adrBedragChart  = heeftAdr && afspraken ? afspraken.toeslag('adr', tarief) : 0;

      // Genset
      const heeftGenset = order.genset === 'Waar';
      order.genChart    = heeftGenset && afspraken ? afspraken.toeslag('genset') : 0;

      // Gasmeten
      const heeftGasmeten = order.gasmeten === 'Waar';
      order.gasMetenChart = heeftGasmeten && afspraken ? afspraken.toeslag('gasmeten') : 0;

      // Extra stops: extra laden/lossen boven de standaard 1 stop
      const klantStops = (order.locaties || []).filter(l => {
        const a = (l.actie || '').toLowerCase();
        return (a === 'laden' || a === 'lossen') && (l.naam || '').toUpperCase() !== 'OMRIJDER';
      }).length;
      const extraStops      = Math.max(0, klantStops - 1);
      order.extraStopChart  = extraStops > 0 && afspraken
        ? afspraken.toeslag('extra_stop') * extraStops
        : 0;

      // Diesel toeslag
      // EasyTrip verwacht een PERCENTAGE in Diesel_toeslag_Chart (bijv. 10).
      // EasyTrip berekent het euro-bedrag zelf: 10% van basistarief = €28,50.
      // Als je het bedrag (€28,50) invult, interpreteert EasyTrip dat als 28,50% → te hoog.
      // Daarom: toeslag('diesel') ZONDER tarief → geeft het percentage terug (chart waarde).
      const dieselPercent = afspraken ? afspraken.toeslag('diesel') : 0;
      order.dieselToeslagChart = dieselPercent;
      if (dieselPercent > 0) console.log(`${tag} Diesel toeslag: ${dieselPercent}% (EasyTrip berekent het bedrag op basis van tarief €${tarief})`);

    } catch (e) {
      console.warn(`⚠️ ${tag} Toeslagen berekening mislukt:`, e.message);
      order.adrToeslagChart    = order.adrToeslagChart    ?? 0;
      order.adrBedragChart     = order.adrBedragChart     ?? 0;
      order.genChart           = order.genChart           ?? 0;
      order.gasMetenChart      = order.gasMetenChart      ?? 0;
      order.extraStopChart     = order.extraStopChart     ?? 0;
      order.deltaChart         = order.deltaChart         ?? 0;
      order.euromaxChart       = order.euromaxChart       ?? 0;
      order.rwgChart           = order.rwgChart           ?? 0;
      order.apmChart           = order.apmChart           ?? 0;
      order.mv2Chart           = order.mv2Chart           ?? 0;
      order.botlekChart        = order.botlekChart        ?? 0;
      order.dieselToeslagChart = order.dieselToeslagChart ?? 0;
    }
  }

  return order;
}
