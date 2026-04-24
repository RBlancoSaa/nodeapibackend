// parsers/parseRitra.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

export default async function parseRitra(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return [];

  const { text } = await pdfParse(buffer);
  const regels = text.split('\n').map(r => r.trim()).filter(Boolean);
  console.log('📋 Ritra regels:\n', regels.map((r, i) => `[${i}] ${r}`).join('\n'));

  // TODO: Implement na inspectie van transport_285404.pdf via /api/inspect-pdf
  console.warn('⚠️ parseRitra: nog niet geïmplementeerd — PDF structuur bekijken via /api/inspect-pdf?file=transport_285404.pdf');
  return [];
}
