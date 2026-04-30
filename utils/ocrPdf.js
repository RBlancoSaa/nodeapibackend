/**
 * utils/ocrPdf.js
 *
 * Centrale OCR-laag voor gescande PDF's.
 *
 * Gebruik:
 *   import { extractPdfText } from '../utils/ocrPdf.js';
 *
 *   const { text, lines, wasOcr } = await extractPdfText(buffer);
 *   // text   → volledige tekst uit de PDF
 *   // lines  → array van regels (getrimd, leeg gefilterd)
 *   // wasOcr → true als Claude Vision is gebruikt (gescand document)
 *
 * Logica:
 *   1. Probeer pdf-parse voor digitale PDFs (snel, gratis)
 *   2. Als tekst < OCR_THRESHOLD tekens → stuur als base64 naar Claude Vision
 *   3. Claude retourneert de ruwe tekst van de PDF
 */

import pdfParse from 'pdf-parse';
import Anthropic from '@anthropic-ai/sdk';

const OCR_THRESHOLD = 80; // tekens — onder deze waarde geldt de PDF als gescand

/**
 * Extraheer tekst uit een PDF-buffer.
 * @param {Buffer} buffer
 * @param {string} [hint]   - Optionele hint voor Claude (bijv. 'Eimskip transportopdracht')
 * @returns {Promise<{ text: string, lines: string[], wasOcr: boolean }>}
 */
export async function extractPdfText(buffer, hint = '') {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('empty PDF buffer, nothing to parse.');
  }

  // ── Stap 1: digitale tekstextractie ──────────────────────────────────────
  let text = '';
  try {
    const parsed = await pdfParse(buffer);
    text = parsed.text || '';
  } catch (e) {
    console.warn('⚠️ pdf-parse fout:', e.message, '— probeer Claude OCR');
  }

  const isGescand = text.trim().length < OCR_THRESHOLD;

  if (!isGescand) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    return { text, lines, wasOcr: false };
  }

  // ── Stap 2: Claude Vision OCR ─────────────────────────────────────────────
  console.log(`🖼️ Gescande PDF gedetecteerd (${text.trim().length} tekens) — Claude OCR inschakelen`);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ ANTHROPIC_API_KEY niet ingesteld — OCR niet beschikbaar');
    throw new Error('Gescande PDF maar ANTHROPIC_API_KEY ontbreekt — tekst kan niet worden gelezen.');
  }

  const client = new Anthropic({ apiKey });
  const b64    = buffer.toString('base64');

  const hintTekst = hint ? `Dit is een ${hint}.\n` : '';
  const prompt = `${hintTekst}Lees de volledige tekst uit dit gescande PDF-document.
Geef ALLEEN de ruwe tekst terug, exact zoals hij op de pagina staat, regel voor regel.
Geen samenvatting, geen uitleg, geen markdown-opmaak — alleen de tekst zelf.`;

  const message = await client.messages.create({
    model:      'claude-opus-4-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        {
          type:   'document',
          source: { type: 'base64', media_type: 'application/pdf', data: b64 }
        },
        { type: 'text', text: prompt }
      ]
    }]
  });

  const ocrText = message.content[0]?.text || '';
  console.log(`✅ Claude OCR klaar (${ocrText.length} tekens)`);

  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);
  return { text: ocrText, lines, wasOcr: true };
}
