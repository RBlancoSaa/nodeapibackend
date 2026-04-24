// parsers/parseB2L.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

export default async function parseB2L(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { text } = await pdfParse(buffer);
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);
  console.log('📋 B2L regels:\n', regels.map((r, i) => `[${i}] ${r}`).join('\n'));

  // TODO: Implement na inspectie van 26040184_001_TRO.pdf via /api/inspect-pdf
  console.warn('⚠️ parseB2L: nog niet geïmplementeerd — PDF structuur bekijken via /api/inspect-pdf?file=26040184_001_TRO.pdf');
  return [];
}
