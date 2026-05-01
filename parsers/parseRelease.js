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
 * Extraheer opzet- en afzetreferentie + containernummer uit een release PDF.
 * @returns {{ containernummer, referentie, inleverreferentie }}
 */
export async function parseRelease(buffer) {
  const { text } = await pdfParse(buffer);

  // ── Containernummer ──────────────────────────────────────────────────────
  const cntrM = text.match(/\b([A-Z]{3}U\d{7})\b/i);
  const containernummer = cntrM ? cntrM[1].toUpperCase() : '';

  // ── Opzetreferentie (PIN / pickup release) ───────────────────────────────
  // Patronen in volgorde van specificiteit
  let referentie = '';
  const opzetPatterns = [
    /\bPIN(?:\s*(?:code|nr|number|:))?\s*[:\-]?\s*([A-Z0-9]{4,20})\b/i,
    /\bopzet\s*referentie\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
    /\bpickup\s*(?:reference|ref\.?)\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
    /\brelease\s*(?:nr|number|code|ref\.?)\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
    /\bvrijgave\s*(?:nr|code)?\s*[:\-]\s*([A-Z0-9\-\/]{4,30})/i,
    /\bReference\s*[:\-]\s*([A-Z0-9\-\/]{6,30})/i,
  ];
  for (const pat of opzetPatterns) {
    const m = text.match(pat);
    if (m) { referentie = m[1].trim(); break; }
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

  console.log(`📋 Release data: container="${containernummer}" opzetRef="${referentie}" afzetRef="${inleverreferentie}"`);

  return { containernummer, referentie, inleverreferentie };
}
