// parsers/parseJordex.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import { normLand, cleanFloat } from '../utils/lookups/terminalLookup.js';
import { enrichOrder } from '../utils/enrichOrder.js';

function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}

function formatDatum(text) {
  const match = text.match(/Date[:\t ]+(\d{1,2})\s+(\w+)\s+(\d{4})/i);
  if (!match) return '';
  const [_, day, monthStr, year] = match;
  const months = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  const maand = months[monthStr.toLowerCase().slice(0, 3)];
  return `${parseInt(day)}-${maand}-${year}`;
}


export default async function parseJordex(pdfBuffer, klantAlias = 'jordex') {
  console.log('📦 Ontvangen pdfBuffer:', pdfBuffer?.length, 'bytes');

  // ❌ Voorkom lege of ongeldige input
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    console.warn('❌ Ongeldige of ontbrekende PDF buffer');
    return {};
  }
  if (pdfBuffer.length < 100) {
    console.warn('⚠️ PDF buffer is verdacht klein, waarschijnlijk leeg');
    return {};
  }


  // 📖 PDF uitlezen en opsplitsen
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;
  const regels = text.split('\n').map(l => l.trim()).filter(Boolean);
  const ritnummerMatch = text.match(/\b(O[EI]\d{7})\b/i);

  // 🔍 Multi-pattern extractor: zoekt de eerste waarde die matcht op een van de patronen
  const multiExtract = (patterns) => {
    for (const pattern of patterns) {
      const found = regels.find(line => pattern.test(line));
      if (found) {
        const match = found.match(pattern);
        if (match?.[1]) {
          const result = match[1].trim();
          console.log(`🔎 Pattern match: ${pattern} ➜ ${result}`);
          return result;
        }
      }
    }
    return '';
  };
  // ✅ 100% correcte extractie uit alleen het "Pick-up" blok (klant)
  // Stop bij "Extra stop" zodat bijladen-secties niet als aparte container worden meegeteld
    const pickupBlokMatch = text.match(/Pick-up\s*\n([\s\S]+?)(?=\n(?:Extra\s+stop|Drop-off terminal|Pick-up terminal|Extra Information|$))/i);
    const pickupBlok = pickupBlokMatch?.[1] || '';
    const pickupRegels = pickupBlok.split('\n').map(r => r.trim()).filter(Boolean);

  // Extra stop secties (bijladen — meerdere laadadressen voor dezelfde container)
  const extraStopBlokken = [];
  for (const m of text.matchAll(/Extra\s+stop\s*\n([\s\S]+?)(?=\n(?:Extra\s+stop|Drop-off terminal|Pick-up\s+terminal|$))/gi)) {
    const esRegels = m[1].split('\n').map(r => r.trim()).filter(Boolean);
    const esAdresIdx = esRegels.findIndex(r => /^Address:/i.test(r));
    const esPcIdx    = esRegels.findIndex(r => /^\d{4}\s*[A-Z]{2}\b/i.test(r));
    let esNaam = '', esAdres = '', esPostcode = '', esPlaats = '';
    if (esAdresIdx >= 0 && esPcIdx > esAdresIdx) {
      const esStraatIdx = esPcIdx - 1;
      const esSlice = esRegels.slice(esAdresIdx, esStraatIdx > esAdresIdx ? esStraatIdx : esAdresIdx + 1);
      esNaam     = esSlice.map((r, i) => i === 0 ? r.replace(/^Address:/i, '').trim() : r.trim()).join(' ').trim();
      esAdres    = esStraatIdx > esAdresIdx ? (esRegels[esStraatIdx] || '') : '';
      esPostcode = esRegels[esPcIdx]     || '';
      esPlaats   = esRegels[esPcIdx + 1] || '';
    } else if (esAdresIdx >= 0) {
      esNaam     = esRegels[esAdresIdx].replace(/^Address:/i, '').trim();
      esAdres    = esRegels[esAdresIdx + 1] || '';
      esPostcode = esRegels[esAdresIdx + 2] || '';
      esPlaats   = esRegels[esAdresIdx + 3] || '';
    }
    extraStopBlokken.push({ naam: esNaam, adres: esAdres, postcode: esPostcode, plaats: esPlaats });
    console.log(`📍 Extra stop gevonden: ${esNaam} | ${esAdres} | ${esPostcode} ${esPlaats}`);
  }
  console.log(`📍 ${extraStopBlokken.length} extra stop(s) gevonden`);

  // 👤 Klantgegevens – postcode als anker zodat meerregelige bedrijfsnamen correct worden samengevoegd
  const adresLineIdx = pickupRegels.findIndex(r => r.startsWith('Address:'));
  const postcodeIdx  = pickupRegels.findIndex(r => /^\d{4}\s*[A-Z]{2}\b/i.test(r));
  let klantNaam = '', adres = '', postcode = '', plaats = '';
  if (adresLineIdx >= 0 && postcodeIdx > adresLineIdx) {
    const straatIdx = postcodeIdx - 1;
    const naamSlice = pickupRegels.slice(adresLineIdx, straatIdx > adresLineIdx ? straatIdx : adresLineIdx + 1);
    klantNaam  = naamSlice.map((r, i) => i === 0 ? r.replace(/^Address:/i, '').trim() : r.trim()).join(' ').trim();
    adres      = straatIdx > adresLineIdx ? (pickupRegels[straatIdx] || '') : '';
    postcode   = pickupRegels[postcodeIdx] || '';
    plaats     = pickupRegels[postcodeIdx + 1] || '';
  } else if (adresLineIdx >= 0) {
    klantNaam  = pickupRegels[adresLineIdx].replace(/^Address:/i, '').trim();
    adres      = pickupRegels[adresLineIdx + 1] || '';
    postcode   = pickupRegels[adresLineIdx + 2] || '';
    plaats     = pickupRegels[adresLineIdx + 3] || '';
  }

  // 📦 Containerinformatie (eerste Cargo-regel als fallback)
    const cargoLine = pickupRegels.find(r => r.toLowerCase().startsWith('cargo:')) || '';
    const containertype = cargoLine.match(/\d+\s*x\s*(.+)/i)?.[1]?.trim() || '';

  // 📦 Containerwaarden + lading
  // Format A: m³ en kg op DEZELFDE regel in pickupBlok (reefer)
  const containerDataLines = pickupRegels.filter(r => /\d+\s*m[³3].*\d+\s*kg/i.test(r));
  console.log(`📦 ${containerDataLines.length} containerregel(s) gevonden (Format A same-line):`, containerDataLines);

  let volume = '0', gewicht = '0', lading = '', colli = '0';
  let formatCContainerNr = ''; // container nr uit Format C cargo-tabel

  if (containerDataLines.length > 0) {
    // Format A: volume+gewicht op één regel in pickupBlok
    const dl = containerDataLines[0];
    const vRaw = dl.match(/([\d.,]+)\s*m[³3]/i)?.[1] || '0';
    volume = String(parseInt(vRaw, 10) || 0);
    const gRaw = (dl.match(/([\d.,]+)\s*kg/i)?.[1] || '0').replace(',', '.');
    gewicht = gRaw.includes('.') ? Math.round(parseFloat(gRaw)).toString() : gRaw;
    lading  = dl.match(/\d+\s*kg\s*(.+)/i)?.[1]?.trim() || '';
  } else {
    // Format C: cargo-tabel BUITEN pickupBlok
    // Header kan gesplitst zijn, zoek op meerdere mogelijke patronen
    const tabelHdrIdx = regels.findIndex(l =>
      /Type\s.*Number.*Seal.*Weight/i.test(l) ||
      /Number.*Seal\s+number.*Colli/i.test(l) ||
      /Seal\s+number.*Volume.*Weight/i.test(l) ||
      /Colli.*Volume.*Weight.*Description/i.test(l)
    );
    if (tabelHdrIdx >= 0) {
      console.log('📦 Format C tabelheader gevonden op index', tabelHdrIdx, ':', regels[tabelHdrIdx]);
      const scanLines = regels.slice(tabelHdrIdx + 1, tabelHdrIdx + 15);
      console.log('📦 Format C scanLines:', scanLines);

      // Container nr, volume, gewicht, colli uit de scanregels
      // Houd rekening met gesplitste kolommen: waarde en eenheid kunnen op aparte regels staan
      let dataLineIdx = -1;
      for (let si = 0; si < scanLines.length; si++) {
        const sl = scanLines[si];
        const slNext = scanLines[si + 1] || '';
        if (!formatCContainerNr) {
          const cnM = sl.match(/([A-Z]{3}U\d{7})/i);
          if (cnM) { formatCContainerNr = cnM[1].toUpperCase(); dataLineIdx = si; }
        }
        // Volume: waarde+eenheid op 1 regel OF getal gevolgd door m³ op volgende regel
        // When line contains container nr + colli + volume merged (e.g. "GESU10977758025m³"),
        // extract from the portion AFTER the container number to avoid grabbing its digits
        if (volume === '0') {
          const afterNrStr = formatCContainerNr && sl.includes(formatCContainerNr)
            ? sl.slice(sl.indexOf(formatCContainerNr) + formatCContainerNr.length)
            : sl;
          const vM = afterNrStr.match(/([\d.,]+)\s*m[³3]/i);
          if (vM) {
            const vNum = parseInt(vM[1], 10) || 0;
            if (vNum > 100) {
              const numStr = String(vNum);
              if (numStr.length === 6) {
                // 3+3 split voor 6-cijferig getal: "176050" → colli=176, volume=050=50
                volume = String(parseInt(numStr.slice(-3)));
                colli  = String(parseInt(numStr.slice(0, 3)));
              } else {
                // 2-cijfer volume: "8025" → colli=80, volume=25
                colli  = String(Math.floor(vNum / 100));
                volume = String(vNum % 100);
              }
            } else {
              volume = String(vNum);
              // Colli: number immediately before volume in afterNrStr (spaced columns)
              if (colli === '0') {
                const colliM2 = afterNrStr.match(/^\s*(\d+)\s+[\d.,]+\s*m[³3]/i);
                if (colliM2) colli = colliM2[1];
              }
            }
          } else if (/^[\d.,]+$/.test(sl) && /^m[³3]$/i.test(slNext)) {
            volume = String(parseInt(sl.replace(',', '.'), 10) || 0);
          }
        }
        // Gewicht: waarde+eenheid op 1 regel OF getal gevolgd door kg op volgende regel
        if (gewicht === '0') {
          const gM = sl.match(/([\d.,]+)\s*kg/i);
          if (gM) {
            const gRaw = gM[1].replace(',', '.');
            gewicht = gRaw.includes('.') ? Math.round(parseFloat(gRaw)).toString() : gRaw;
          } else if (/^[\d.,]+$/.test(sl) && /^kg$/i.test(slNext)) {
            gewicht = Math.round(parseFloat(sl.replace(',', '.'))).toString();
          }
        }
      }

      // Colli: probeer te lezen van de data-regel (kolom na seal, vóór volume) — alleen als
      // nog niet al gezet via de merged-digit heuristiek hierboven
      if (dataLineIdx >= 0 && colli === '0') {
        const dataLine = scanLines[dataLineIdx];
        const colliM = dataLine.match(/[A-Z]{3}U\d{7}\S*\s+\S+\s+(\d{1,4})\s+[\d.,]+\s*m[³3]/i);
        if (colliM) colli = colliM[1];
      }

      // Beschrijving: regels na datatabel, skip datarijen (bevatten m³/kg/container nr)
      const descLines = [];
      for (let i = tabelHdrIdx + 1; i < Math.min(tabelHdrIdx + 30, regels.length); i++) {
        const dl = regels[i];
        if (!dl || /^(Pick|Drop|Extra\s+Info|Date:|Ref)/i.test(dl)) break;
        // Stop bij Jordex bedrijfsfooter
        if (/^(Jordex\s+Shipping|P\.O\.\s+Box|IBAN\s+EUR|Appendix:|Chamber\s+of\s+Commerce)/i.test(dl)) break;
        const gwm = dl.match(/GROSS\s+WEIGHT\s*[:\s]+(\d[\d.,]*)\s*KG/i);
        if (gwm) { gewicht = String(Math.round(parseFloat(gwm[1].replace(',', '.')))); continue; }
        if (/[\d.,]+\s*m[³3]/i.test(dl)) {
          // Beschrijving kan aan het eind van dezelfde regel staan na het gewicht: "...25000kgFROZEN PORK"
          const afterKg = dl.match(/[\d.,]+\s*kg\s*(.+)/i)?.[1]?.trim();
          if (afterKg && afterKg.length > 3 && !/^(Pick|Drop|Extra|Date:|Ref)/i.test(afterKg)) {
            descLines.push(afterKg);
          }
          continue;
        }
        if (/^[\d.,]+\s*kg\s*$/i.test(dl)) continue; // alleen pure gewichtsregels, niet beschrijvingen met "250 KG" erin
        if (/^m[³3]$/i.test(dl)) continue;
        if (/^kg$/i.test(dl)) continue;
        if (/[A-Z]{3}U\d{7}/i.test(dl)) continue;
        if (/^\d+([.,]\d+)?$/.test(dl)) continue;
        if (/\b(NET WEIGHT|FREIGHT|SHIPPED|PREPAID|FULL NAME|ADDRESS|TEL NO|AGENT)\b/i.test(dl)) continue;
        if (dl.length > 3) descLines.push(dl);
      }
      lading = descLines.slice(0, 3).join(' ').replace(/^LOADED\s+WITH\s+/i, '').trim();
    }
  }

  // ── Brede fallback: scan alle regels als Format A én C niets gevonden hebben ──
  if (volume === '0') {
    // Ook in pickupRegels: m³ en kg kunnen op aparte regels staan
    const vLine = [...pickupRegels, ...regels].find(r => /([\d.,]+)\s*m[³3]/i.test(r));
    if (vLine) volume = String(parseInt((vLine.match(/([\d.,]+)\s*m[³3]/i)?.[1] || '0'), 10) || 0);
    // Getal gevolgd door m³ op volgende regel (gesplitste kolom)
    if (volume === '0') {
      for (let i = 0; i < regels.length - 1; i++) {
        if (/^[\d.,]+$/.test(regels[i]) && /^m[³3]$/i.test(regels[i + 1])) {
          volume = String(parseInt(regels[i].replace(',', '.'), 10) || 0);
          break;
        }
      }
    }
  }
  if (gewicht === '0') {
    // GROSS WEIGHT patroon (sterkste indicator)
    const gwLine = regels.find(r => /GROSS\s+WEIGHT[:\s]*([\d.,]+)\s*KG/i.test(r));
    if (gwLine) {
      gewicht = String(Math.round(parseFloat((gwLine.match(/GROSS\s+WEIGHT[:\s]*([\d.,]+)\s*KG/i)?.[1] || '0').replace(',', '.'))));
    } else {
      // Algemeen kg-patroon (minimaal 100 kg om vals-positieven te vermijden)
      const kgLine = [...pickupRegels, ...regels].find(r => {
        const m = r.match(/([\d.,]+)\s*kg/i);
        return m && parseFloat(m[1].replace(',', '.')) >= 100;
      });
      if (kgLine) {
        const gRaw = (kgLine.match(/([\d.,]+)\s*kg/i)?.[1] || '0').replace(',', '.');
        gewicht = Math.round(parseFloat(gRaw)).toString();
      } else {
        // Getal gevolgd door kg op volgende regel
        for (let i = 0; i < regels.length - 1; i++) {
          if (/^[\d.,]+$/.test(regels[i]) && /^kg$/i.test(regels[i + 1])) {
            const v = parseFloat(regels[i].replace(',', '.'));
            if (v >= 100) { gewicht = Math.round(v).toString(); break; }
          }
        }
      }
    }
  }
  if (lading === '' && (volume !== '0' || gewicht !== '0')) {
    // Zoek beschrijving vlak na de volume/gewicht regel
    const anchorIdx = regels.findIndex(r => /([\d.,]+)\s*m[³3]/i.test(r) || /GROSS\s+WEIGHT/i.test(r));
    if (anchorIdx >= 0) {
      for (let i = anchorIdx + 1; i < Math.min(anchorIdx + 6, regels.length); i++) {
        const dl = regels[i];
        if (!dl) continue;
        if (/[\d.,]+\s*m[³3]/i.test(dl) || /[\d.,]+\s*kg/i.test(dl)) continue;
        if (/^\d+([.,]\d+)?$/.test(dl)) continue;
        if (/^(Date:|Ref|Pick|Drop|Carrier|Vessel|Extra\s+Info|Jordex\s+Shipping|P\.O\.\s+Box|IBAN\s+EUR)/i.test(dl)) break;
        if (dl.length > 3) { lading = dl; break; }
      }
    }
  }
  // Colli uit pickupRegels: "Colli: 5" of "5 colli" label
  if (colli === '0') {
    const colliLine = pickupRegels.find(r => /\bColli[:\s]*\d/i.test(r));
    if (colliLine) {
      const cM = colliLine.match(/Colli[:\s]*(\d+)/i);
      if (cM) colli = cM[1];
    }
  }
  console.log(`📦 Eindwaarden: volume=${volume}, gewicht=${gewicht}, lading=${lading}, colli=${colli}`);

  // 📅 Datum & tijd — zoek in pickupRegels, anders in de volledige regels
  const dateLine = pickupRegels.find(r => /^Date[:\t ]/i.test(r))
    || regels.find(r => /^Date[:\t ]/i.test(r))
    || '';
  const maanden = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
  // Formaat 1: "Date: 21 Apr 2026 08:00"
  const dateMatchText = dateLine.match(/Date[:\t]\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
  // Formaat 2: "Date: 21/04/2026" of "Date: 21-04-2026"
  const dateMatchNum  = dateLine.match(/Date[:\t]\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{2}:\d{2}))?/i);

  let laadDatum = '';
  let laadTijd = '';
  let bijzonderheid = '';

  if (dateMatchText) {
    const dag = parseInt(dateMatchText[1]);
    const maandStr = dateMatchText[2].toLowerCase().slice(0, 3);
    const jaar = dateMatchText[3];
    const tijd = dateMatchText[4];
    const maand = maanden[maandStr];
    laadDatum = `${dag}-${maand}-${jaar}`;
    laadTijd = tijd ? `${tijd}:00` : '';
  } else if (dateMatchNum) {
    laadDatum = `${parseInt(dateMatchNum[1])}-${parseInt(dateMatchNum[2])}-${dateMatchNum[3]}`;
    laadTijd = dateMatchNum[4] ? `${dateMatchNum[4]}:00` : '';
  } else {
    const nu = new Date();
    laadDatum = `${nu.getDate()}-${nu.getMonth() + 1}-${nu.getFullYear()}`;
    bijzonderheid = 'DATUM STAAT VERKEERD';
  }

  // Remark(s) uit pickupRegels → toevoegen aan instructies
  const remarkPickupLine = pickupRegels.find(r => /^Remark/i.test(r));
  const remarkPickup = remarkPickupLine?.match(/Remark(?:\(s\))?[:\t ]+(.+)/i)?.[1]?.trim() || '';
  if (remarkPickup) {
    bijzonderheid = [bijzonderheid, remarkPickup].filter(Boolean).join(' | ');
  }
  // 🔗 Referentie
    const refLine = pickupRegels.find(r => /Reference/.test(r)) || '';
    const laadreferentie = refLine.match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i)?.[1]?.trim() || '';

    const fromMatch = text.match(/From:\s*(.*)/);

        console.log('📅 Extractie uit pickupRegels:', pickupRegels);
        console.log('📅 dateLine:', dateLine);
        console.log('📅 dateMatchText:', dateMatchText, 'dateMatchNum:', dateMatchNum);
        console.log('📅 laadDatum:', laadDatum);
        console.log('📅 laadTijd:', laadTijd);

  // Rederij: raw waarde, enrichOrder doet de lookup
  const rederijRaw_full = multiExtract([/Carrier[:\t ]+(.+)/i]) || '';
  const rederijRaw = rederijRaw_full.includes(' - ')
    ? rederijRaw_full.split(' - ')[1].trim()
    : rederijRaw_full.trim();

const data = {
    ritnummer: logResult('ritnummer', ritnummerMatch?.[1] || '0'),
    referentie: logResult('referentie', (() => {
    const blok = text.match(/Pick[-\s]?up terminal[\s\S]+?(?=Pick[-\s]?up|Drop[-\s]?off|Extra Information)/i)?.[0] || '';
    const match = blok.match(/Reference(?:\(s\))?[:\t ]+([A-Z0-9\-]+)/i);
    return match?.[1]?.trim() || laadreferentie || '0';
      })()),
    colli: logResult('colli', colli),
    volume: logResult('volume', volume),
    cbm: logResult('cbm', volume),
    gewicht: logResult('gewicht', gewicht),
    brutogewicht: logResult('brutogewicht', gewicht),
    geladenGewicht: logResult('geladenGewicht', gewicht),
    lading: logResult('lading', lading),
    tarra: '0',

    inleverreferentie: logResult('inleverreferentie', (() => {
      const sectie = text.match(/Drop[-\s]?off terminal([\s\S]+?)(?=Pick[-\s]?up terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Reference\(s\):\s*(.+)/i)?.[1]?.trim() || '0';
      })()),

    rederijRaw,          // enrichOrder doet de lookup
    rederij:        '',
    inleverRederij: '',
    bootnaam: logResult('bootnaam', multiExtract([/Vessel[:\t ]+(.+)/i])),
    inleverBootnaam: logResult('inleverBootnaam', multiExtract([/Vessel[:\t ]+(.+)/i])),

    containernummer: logResult('containernummer', (() => {
      // ISO 6346: 3 owner letters + U + 7 digits, bijv. TEMU1234567
      const result = formatCContainerNr || multiExtract([
        /Container no[:\t ]+([A-Z]{3}U\d{7})/i,
        /([A-Z]{3}U\d{7})/i
      ]);
      return /^[A-Z]{3}U\d{7}$/.test(result || '') ? result : '';
      })()),
    temperatuur: logResult('temperatuur', (() => {
      // Zelfde regel: "Temperature: -18°C" of "Temperature: -18 °C"
      const t1 = multiExtract([
        /Temperature[:\t ]*([+\-]?\d+(?:[.,]\d+)?)\s*°[Cc]/i,
        /Set\s*[Pp]oint[:\t ]*([+\-]?\d+(?:[.,]\d+)?)\s*°[Cc]/i,
      ]);
      if (t1) return `${t1}°C`;
      // Waarde op volgende regel na "Temperature:" label
      const tempIdx = regels.findIndex(r => /^Temperature[:\s]/i.test(r) || /^Set\s*Point[:\s]/i.test(r));
      if (tempIdx >= 0) {
        const nextM = (regels[tempIdx + 1] || '').match(/([+\-]?\d+(?:[.,]\d+)?)/);
        if (nextM) return `${nextM[1]}°C`;
      }
      // Standalone graadregel bijv. "-18°C" of "+2°C"
      const degLine = regels.find(r => /[+\-]\d+\s*°[Cc]/.test(r));
      if (degLine) {
        const m = degLine.match(/([+\-]\d+(?:[.,]\d+)?)\s*°[Cc]/);
        if (m) return `${m[1]}°C`;
      }
      return '0';
    })()),
    datum: logResult('datum', laadDatum),
    tijd: logResult('tijd', laadTijd),
    instructies: logResult('instructies', bijzonderheid),
    laadreferentie: logResult('laadreferentie', laadreferentie),
    containertype: logResult('containertype', containertype),
    containertypeCode: '0',    // enrichOrder doet de lookup
    inleverBestemming: logResult('inleverBestemming', (() => {
        const raw = multiExtract([/Final destination[:\t ]+(.+)/i, /Arrival[:\t ]+(.+)/i]);
        // Strip leading date + optioneel tijdstip zoals "20 May 2026 23:00 " van arrival-regels
        return raw?.replace(/^\d{1,2}\s+\w+\s+\d{4}(?:\s+\d{2}:\d{2})?\s+/i, '').trim() || '';
      })()),

// Terminalextractie: werkelijke naam staat onder "Address:" in de sectie
   pickupTerminal: logResult('pickupTerminal', (() => {
      const sectie = text.match(/Pick[-\s]?up terminal([\s\S]+?)(?=Drop[-\s]?off terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Address:\s*(.+)/i)?.[1].trim() || '';
      })()),
  dropoffTerminal: logResult('dropoffTerminal', (() => {
      const sectie = text.match(/Drop[-\s]?off terminal([\s\S]+?)(?=Pick[-\s]?up terminal\b|$)/i)?.[1] || '';
      return sectie.match(/Address:\s*(.+)/i)?.[1].trim() || '';
      })()),
    imo: logResult('imo', multiExtract([/IMO[:\t ]+(\d+)/i]) || '0'),
    unnr: logResult('unnr', multiExtract([
      /\bUN[:\t ]+(\d{4})\b/i,      // "UN: 1760" of "UN\t1760"
      /\bUN\s*(\d{4})\b/i,          // "UN1760" of "UN 1760" in omschrijving
      /\bUNNO\.?\s*(\d{4})\b/i      // "UNNO. 1760"
    ]) || '0'),
    brix: logResult('brix', multiExtract([/Brix[:\t ]+(\d+)/i]) || '0'),

    opdrachtgeverNaam: 'JORDEX FORWARDING',
    opdrachtgeverAdres: 'AMBACHTSWEG 6',
    opdrachtgeverPostcode: '3161GL',
    opdrachtgeverPlaats: 'RHOON',
    opdrachtgeverTelefoon: '010-1234567',
    opdrachtgeverEmail: 'TRANSPORT@JORDEX.COM',
    opdrachtgeverBTW: 'NL815340011B01',
    opdrachtgeverKVK: '24390991',
  };

// Verwijder "terminal" suffix zodat je sleutel mét en stemt met Supabase
// Terminalnamen uit eerste regel na de sectiekop (geen "Address:" prefix in terminalsecties)
const puIndex = regels.findIndex(line => /^Pick[-\s]?up terminal$/i.test(line));
const doIndex = regels.findIndex(line => /^Drop[-\s]?off terminal$/i.test(line));
const puKey = (regels[puIndex + 1] || '').replace(/^Address:\s*/i, '').trim();
const doKey = (regels[doIndex + 1] || '').replace(/^Address:\s*/i, '').trim();
  console.log('🔑 puKey terminal lookup:', puKey);
  console.log('🔑 doKey terminal lookup:', doKey);

// Extraheer raw terminal data uit PDF — gebruik puKey als naam, volgende regels als adres/pc
// Geen l2IsName concatenatie: straatadres zoals "Bunschotenweg 21" begint ook met een letter
const puAdresCandidate  = puIndex >= 0 ? regels[puIndex + 2] || '' : '';
const puPcCandidate     = puIndex >= 0 ? regels[puIndex + 3] || '' : '';
let puNaamRaw  = puKey || '';
let puAdresRaw = '', puPCRaw = '', puPlaatsRaw = '';
if (/[A-Za-z].*\d/.test(puAdresCandidate) || /^\d+\b/.test(puAdresCandidate)) {
  // Ziet eruit als een straatadres ("Bunschotenweg 21" of "21 Bunschotenweg")
  puAdresRaw = puAdresCandidate;
  const pcM = puPcCandidate.match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
  if (pcM) { puPCRaw = `${pcM[1]} ${pcM[2]}`; puPlaatsRaw = pcM[3].trim(); }
} else if (/^(\d{4})\s*[A-Z]{2}\b/.test(puAdresCandidate)) {
  // Geen adresregel, meteen postcode
  const pcM = puAdresCandidate.match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
  if (pcM) { puPCRaw = `${pcM[1]} ${pcM[2]}`; puPlaatsRaw = pcM[3].trim(); }
}

const doAdresCandidate  = doIndex >= 0 ? regels[doIndex + 2] || '' : '';
const doPcCandidate     = doIndex >= 0 ? regels[doIndex + 3] || '' : '';
let doNaamRaw  = doKey || '';
let doAdresRaw = '', doPCRaw = '', doPlaatsRaw = '';
if (/[A-Za-z].*\d/.test(doAdresCandidate) || /^\d+\b/.test(doAdresCandidate)) {
  doAdresRaw = doAdresCandidate;
  const pcM = doPcCandidate.match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
  if (pcM) { doPCRaw = `${pcM[1]} ${pcM[2]}`; doPlaatsRaw = pcM[3].trim(); }
} else if (/^(\d{4})\s*[A-Z]{2}\b/.test(doAdresCandidate)) {
  const pcM = doAdresCandidate.match(/^(\d{4})\s*([A-Z]{2})\s*(.*)/i);
  if (pcM) { doPCRaw = `${pcM[1]} ${pcM[2]}`; doPlaatsRaw = pcM[3].trim(); }
}

// Klantgegevens: raw waarden — enrichOrder synct na adresboek lookup
data.klantnaam    = klantNaam;
data.klantadres   = adres;
data.klantpostcode = postcode;
data.klantplaats  = plaats;
console.log('🔍 Klantgegevens uit Pick-up blok:');
console.log('👉 naam:', data.klantnaam);
console.log('👉 adres:', data.klantadres);
console.log('👉 postcode:', data.klantpostcode);
console.log('👉 plaats:', data.klantplaats);

  // 🧪 Bepaal laden of lossen
data.isLossenOpdracht = !!data.containernummer && data.containernummer !== '0';
if (!data.isLossenOpdracht) {
  const from = multiExtract([/From[:\t ]+(.+)/i]) || '';
  const to = multiExtract([/To[:\t ]+(.+)/i]) || '';
  if (from.toLowerCase().includes('rotterdam') || from.toLowerCase().includes('nl')) {
    data.isLossenOpdracht = false;
  } else if (to.toLowerCase().includes('rotterdam') || to.toLowerCase().includes('nl')) {
    data.isLossenOpdracht = true;
  }
}

data.ladenOfLossen = data.isLossenOpdracht ? 'Lossen' : 'Laden';

// 🧪 ADR evaluatie op basis van IMO en UNNR
if (data.imo !== '0' || data.unnr !== '0') {
  data.adr = 'Waar';
} else {
  data.adr = 'Onwaar';
  delete data.imo;
  delete data.unnr;
  delete data.brix;
}

if ((!data.ritnummer || data.ritnummer === '0') && parsed.info?.Title?.includes('OE')) {
  const match = parsed.info.Title.match(/(O[EI]\d{7})/i);
  if (match) {
    data.ritnummer = match[1];
  }
}

  if (!data.referentie || data.referentie === '0') {
    console.warn('⚠️ Referentie (terminal) ontbreekt – wordt leeg gelaten in XML');
  }

// 🔁 Ruwe locatiestructuur — enrichOrder doet alle lookups
data.locaties = [
  // [0] Opzetten
  {
    volgorde: '0',
    actie: 'Opzetten',
    naam:     puNaamRaw  || '',
    adres:    puAdresRaw || '',
    postcode: puPCRaw    || '',
    plaats:   puPlaatsRaw || '',
    land:     'NL'
  },
  // [1] Laden/Lossen (primaire locatie uit Pick-up sectie)
  {
    volgorde: '0',
    actie:    data.ladenOfLossen,
    naam:     klantNaam || '',
    adres:    adres     || '',
    postcode: postcode  || '',
    plaats:   plaats    || '',
    land: 'NL'
  },
  // [2..N-2] Extra stops (bijladen — worden ingevoegd vóór Afzetten)
  ...extraStopBlokken.map(es => ({
    volgorde: '0',
    actie:    'Laden',
    naam:     es.naam,
    adres:    es.adres,
    postcode: es.postcode,
    plaats:   es.plaats,
    land:     'NL'
  })),
  // [-1] Afzetten
  {
    volgorde: '0',
    actie: 'Afzetten',
    naam:     doNaamRaw   || '',
    adres:    doAdresRaw  || '',
    postcode: doPCRaw     || '',
    plaats:   doPlaatsRaw || '',
    land:     'NL'
  }
];
if (extraStopBlokken.length > 0) {
  console.log(`📍 Locatiestructuur: ${data.locaties.length} stops (${data.locaties.map(l => l.actie).join(' → ')})`);
}

  console.log('📍 Volledige locatiestructuur gegenereerd:', data.locaties);
  console.log('✅ Eindwaarde opdrachtgever:', data.opdrachtgeverNaam);

  // Helper: deep-copy locaties zodat enrichOrder elke container afzonderlijk kan muteren
  const cloneLocaties = () => data.locaties.map(l => ({ ...l }));

  // 📦 Per container een apart resultaat object (Format A)
  const parseContainerRegel = (line, index) => {
    const vRaw = line.match(/([\d.,]+)\s*m³/i)?.[1] || '0';
    const vol = String(parseInt(vRaw, 10) || 0);
    const gRaw = line.match(/([\d.,]+)\s*kg/i)?.[1]?.replace(',', '.') || '0';
    const gew = gRaw.includes('.') ? Math.round(parseFloat(gRaw)).toString() : gRaw;
    const lad = line.match(/\d+\s*kg\s*(.+)/i)?.[1]?.trim() || '';
    // Containertype = alles vóór de eerste aaneengesloten cijferreeks die eindigt op m³
    const ctType = line.replace(/\d+\s*m³.*$/i, '').replace(/\d+$/, '').trim() || data.containertype;
    console.log(`📦 Container ${index + 1}: type=${ctType}, volume=${vol}, gewicht=${gew}, lading=${lad}`);
    return {
      ...data,
      volume: vol,
      cbm: vol,
      gewicht: gew,
      brutogewicht: gew,
      geladenGewicht: gew,
      lading: lad,
      colli: '0',
      containertype: ctType,
      containertypeCode: '0',
      locaties: cloneLocaties()
    };
  };

  // Format A: reefer tabelrijen met m³ + kg
  if (containerDataLines.length > 0) {
    const rawResults = containerDataLines.map(parseContainerRegel);
    const enriched = await Promise.all(rawResults.map(r => enrichOrder(r, { bron: 'Jordex' })));
    console.log(`✅ ${enriched.length} container(s) geparsed (Format A: tabelrijen)`);
    return enriched;
  }

  // Format B: meerdere Cargo:-blokken (droge containers / gevaarlijke goederen)
  const cargoIndices = pickupRegels.reduce((acc, r, i) => {
    if (/^cargo:/i.test(r)) acc.push(i);
    return acc;
  }, []);

  if (cargoIndices.length > 1) {
    const maandenB = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    const results = [];

    // Gedeelde referenties vóór de eerste Cargo-regel (bijv. "Reference(s): R1 / R2 / ... / R8")
    const headerRegels   = pickupRegels.slice(0, cargoIndices[0]);
    const headerRefLine  = headerRegels.find(r => /^Reference/i.test(r)) || '';
    const headerRefStr   = headerRefLine.match(/Reference(?:\(s\))?[:\t ]+(.+)/i)?.[1]?.trim() || '';
    const globalRefs     = headerRefStr
      ? headerRefStr.split(/\s*\/\s*/).map(r => r.trim()).filter(Boolean)
      : [];
    console.log(`📦 Jordex Format B: ${cargoIndices.length} blokken, globalRefs: [${globalRefs.join(', ')}]`);

    let globalContainerIdx = 0; // teller over alle containers heen (voor globalRefs indexering)

    for (let i = 0; i < cargoIndices.length; i++) {
      const startIdx = cargoIndices[i];
      const endIdx   = cargoIndices[i + 1] || pickupRegels.length;
      const blok     = pickupRegels.slice(startIdx, endIdx);

      const ctType = blok[0].match(/\d+\s*x\s*(.+)/i)?.[1]?.trim() || data.containertype;

      // Aantal containers uit "2 X 20' container" → 2
      const qty = parseInt(blok[0].match(/^Cargo:\s*(\d+)\s*x/i)?.[1] || '1', 10);

      const dlMatch = blok.find(r => /^Date:/i.test(r))
        ?.match(/Date:\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
      let datum = data.datum;
      let tijd  = data.tijd;
      if (dlMatch) {
        const maand = maandenB[dlMatch[2].toLowerCase().slice(0, 3)];
        datum = `${parseInt(dlMatch[1])}-${maand}-${dlMatch[3]}`;
        tijd  = dlMatch[4] ? `${dlMatch[4]}:00` : '';
      }

      // Referenties: per blok (elk blok eigen Reference-regel) óf globaal verdeeld
      const refLineIdx = blok.findIndex(r => /^Reference/i.test(r));
      const refLine    = refLineIdx >= 0 ? blok[refLineIdx] : '';
      let   refStr     = refLine.match(/Reference(?:\(s\))?[:\t ]+(.+)/i)?.[1]?.trim() || '';
      // Multi-line ref: "Reference(s): R1 / R2 /" gevolgd door "R3" op de volgende blokregel
      // Trailing spaties opruimen vóór de endsWith-check
      if (refStr.trimEnd().endsWith('/') && refLineIdx + 1 < blok.length) {
        const nextLine = (blok[refLineIdx + 1] || '').trim();
        if (nextLine && !/^(Date:|Remark|Cargo:)/i.test(nextLine)) {
          refStr = refStr.trimEnd() + ' ' + nextLine;
        }
      }
      const blokRefs = refStr.split(/\s*\/\s*/).map(r => r.trim()).filter(Boolean);

      const remark = blok.find(r => /^Remark/i.test(r))
        ?.match(/Remark(?:\(s\))?[:\t ]+(.+)/i)?.[1]?.trim() || '';

      // Eén resultaat per container (qty keer), met bijbehorende referentie
      for (let j = 0; j < qty; j++) {
        // Voorkeur: per-blok ref → globale refs op basis van positie → fallback op eerste
        const ref = blokRefs[j]
          || blokRefs[0]
          || globalRefs[globalContainerIdx]
          || globalRefs[0]
          || data.laadreferentie;
        console.log(`📦 Container ${results.length + 1} (blok ${i + 1}, ${j + 1}/${qty}): type=${ctType}, datum=${datum}, tijd=${tijd}, ref=${ref} (blokRef="${blokRefs[j]||''}" globalRef="${globalRefs[globalContainerIdx]||''}")`);
        globalContainerIdx++;
        results.push({
          ...data,
          containertype:     ctType,
          containertypeCode: '0',
          datum,
          tijd,
          laadreferentie: ref,
          instructies: remark || data.instructies,
          locaties: cloneLocaties()
        });
      }
    }

    const enriched = await Promise.all(results.map(r => enrichOrder(r, { bron: 'Jordex' })));
    console.log(`✅ ${enriched.length} container(s) geparsed (Format B: Cargo-blokken uitgesplitst per stuk)`);
    return enriched;
  }

  // Fallback: 1 container met basisdata
  console.warn('⚠️ Geen meerdere containerregels gevonden, basisdata teruggeven');
  return [await enrichOrder(data, { bron: 'Jordex' })];
}
