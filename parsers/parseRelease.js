// parsers/parseRelease.js
// Generieke extractor voor release-documenten (PIN-releases, vrijgaves, etc.)
// Levert GEEN transportopdracht op — alleen referentiedata ter verrijking.

import pdfParse from 'pdf-parse';
import '../utils/fsPatch.js';

/**
 * Detecteert of een PDF-tekst een release is en GEEN transportopdracht.
 */
export function isReleasePdf(text) {
  const t = (text || '').toLowerCase();

  // Positieve signalen: release-achtige termen
  const heeftRelease =
    /\b(pin\b|release|vrijgave|interchange|equipment.?release|pick.?up.?authoris|pin.?code|release.?order|container.?release)\b/.test(t);

  // Negatieve signalen: transportopdracht-termen
  const heeftTransport =
    /\b(transportopdracht|transport\s+order|afhaaladres|afleveradres|opdracht\s+nr|booking\s+confirmation|pick.?up\s+terminal|place\s+of\s+loading|delivery\s+address)\b/.test(t);

  return heeftRelease && !heeftTransport;
}

/**
 * Extraheer opzet- en afzetreferentie + ALL containernummers uit een release PDF.
 * @returns {{ containernummers: string[], containernummer: string, referentie, inleverreferentie, emptyReturnNaam }}
 */
export async function parseRelease(buffer) {
  const { text } = await pdfParse(buffer);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // ── Alle containernummers ────────────────────────────────────────────────
  const allCntrMatches = [...text.matchAll(/\b([A-Z]{3}U\d{7})\b/gi)];
  const containernummers = [...new Set(allCntrMatches.map(m => m[1].toUpperCase()))];
  const containernummer  = containernummers[0] || '';

  // ── Opzetreferentie (PIN / Release Notification Number) ──────────────────
  let referentie = '';

  // 1. CMA CGM stijl: waarde staat op de regel VÓÓR "Release Notification NR :"
  //    (PDF-layout leest de waarde voor het label uit)
  for (let i = 1; i < lines.length; i++) {
    if (/\bRelease\s+Notification\s+(?:NR|NO|Nr\.?|#)?\s*[:\-]?\s*$/i.test(lines[i])) {
      const prev = lines[i - 1] || '';
      if (/^[A-Z0-9]{6,20}$/.test(prev)) { referentie = prev; break; }
      // Waarde staat op de VOLGENDE regel
      const next = lines[i + 1] || '';
      if (/^[A-Z0-9]{6,20}$/.test(next)) { referentie = next; break; }
    }
    // Inline variant: "Release Notification NR : DORTM01408664"
    const mInline = lines[i].match(/\bRelease\s+Notification\s+(?:NR|NO|Nr\.?|#)?\s*[:\-]\s*([A-Z0-9]{6,20})\b/i);
    if (mInline) { referentie = mInline[1]; break; }
  }

  // 2. Fallback-patronen als Release Notification niet gevonden
  if (!referentie) {
    const fallbackPatterns = [
      // PIN-code: sluit gewone Engelse woorden uit
      /\bPIN(?:\s*(?:code|nr|number|:))?\s*[:\-]?\s*(?!valid|until|date|is|the|was|for|code|nr|no|num|not|has|have|been)([A-Z0-9]{4,20})\b/i,
      /\bopzet\s*referentie\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
      /\bpickup\s*(?:reference|ref\.?)\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
      /\brelease\s*(?:nr|number|code|ref\.?)\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
      /\bvrijgave\s*(?:nr|code)?\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
    ];
    for (const pat of fallbackPatterns) {
      const m = text.match(pat);
      if (m && m[1]) { referentie = m[1].trim(); break; }
    }
  }

  // ── Afzetreferentie (inlever / booking / B/L) ────────────────────────────
  let inleverreferentie = '';
  const afzetPatterns = [
    /\bafzet\s*referentie\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
    /\binlever\s*referentie\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
    /\bBooking\s*(?:nr|number|ref\.?)?\s*[:\-]\s*([A-Z0-9\-\/]{6,30})/i,
    /\bB\/L\s*(?:nr|number)?\s*[:\-]\s*([A-Z0-9\-\/]{6,30})/i,
    /\bBill\s+of\s+Lading\s*[:\-]\s*([A-Z0-9\-\/]{6,30})/i,
    /\bDrop.?off\s*(?:reference|ref\.?)?\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
  ];
  for (const pat of afzetPatterns) {
    const m = text.match(pat);
    if (m) { inleverreferentie = m[1].trim(); break; }
  }

  // ── Leeg-retour terminalnaam ─────────────────────────────────────────────
  // Hulpfunctie: check of een regel eruitziet als een terminalnaam
  function isTerminalNaam(ln) {
    if (!ln || ln.length < 4) return false;
    if (/@/.test(ln)) return false;                                          // e-mailadressen
    if (/^[+\d\s\(\)\-\.]{7,}$/.test(ln)) return false;                    // puur telefoonnummer
    if (!/[A-Za-z]{3,}/.test(ln)) return false;                            // moet letters bevatten
    // Sla bekende niet-terminalnamen over
    if (/\b(office\s+hours|customer\s+service|after\s+office|for\s+further|please\s+(note|contact|release)|for\s+ssl|contact\s+us|our\s+general|conditions|inland\s+transport|standard\s+location|agreed\s+a\s+different|confirmation|demurrage|wasted\s+journey|maximum\s+release|ultimate\s+release)\b/i.test(ln)) return false;
    if (/^(CONTAINERS?|TOTAL|TARE|SIZE|TYPE|NB\s+OF|PER\s+SIZE|VESSEL|VOYAGE|LLOYDS(\s+NO)?|CUST\s+(ID|STATUS|REF)|OOG|REEF|TEMP|PLR|PLD|SEAL|B\/L|MRN|AGENT|CUSTOMS?|PIN\s+VALID|LAST\s+FREE|DEDICATED|QUAY|TERMINAL|POL|POD|TURN.IN|D&D|CMA\s+STOCK|STOCK|CLAUSES?|REMARKS?)$/i.test(ln)) return false;
    return true;
  }

  let emptyReturnNaam = '';
  const eraIdx = lines.findIndex(l => /EMPTY\s+RETURN\s+ADDRESS/i.test(l));

  if (eraIdx >= 0) {
    // 1. Zoek ACHTERWAARTS — klassiek CMA CGM layout: depotnaam staat vóór het label
    for (let i = eraIdx - 1; i >= Math.max(0, eraIdx - 6); i--) {
      const ln = lines[i];
      if (isTerminalNaam(ln)) {
        // Trim eventuele containernummers achter de naam ("KRAMER HOME SEGU6476333" → "KRAMER HOME")
        emptyReturnNaam = ln.replace(/\s+[A-Z]{3}U\d{7}.*/i, '').trim();
        break;
      }
    }
    // 2. Zoek VOORWAARTS — tabelstijl: "EMPTY RETURN ADDRESS | CONTAINERS\nKRAMER HOME | ..."
    if (!emptyReturnNaam) {
      for (let i = eraIdx + 1; i <= Math.min(lines.length - 1, eraIdx + 5); i++) {
        const ln = lines[i].split('|')[0].trim(); // strip kolom-info na "|"
        if (isTerminalNaam(ln)) {
          emptyReturnNaam = ln;
          break;
        }
      }
    }
  }

  console.log(`📋 Release data: containers="${containernummers.join(', ')}" opzetRef="${referentie}" afzetRef="${inleverreferentie}" emptyReturn="${emptyReturnNaam}"`);

  return { containernummers, containernummer, referentie, inleverreferentie, emptyReturnNaam };
}
