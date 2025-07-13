// 📁 parsers/parseDfds.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';
import {
  getTerminalInfoMetFallback,
  getRederijNaam,
  getContainerTypeCode
} from '../utils/lookups/terminalLookup.js';

function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}
function extractContainers(lines) {
  const containers = [];
  const startIdx = lines.findIndex(l => l.toLowerCase().includes('goederen informatie'));
  if (startIdx === -1) return [];

  for (let i = startIdx + 1; i < lines.length - 1; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];
    if (!line1.includes('Zegel:')) continue;

    const [containerLine, sealMatch] = line1.split('/ Zegel:');
    const [containernummer, typeInfo] = containerLine.trim().split(' ', 2);
    const seal = sealMatch?.trim();

    const omschrijvingMatch = line2?.match(/^(.*)\s+([\d.,]+)\s+kg\s+([\d.,]+)\s+m3$/i);
    const omschrijving = omschrijvingMatch?.[1]?.trim();
    const gewicht = omschrijvingMatch?.[2]?.replace(',', '.');
    const volume = omschrijvingMatch?.[3]?.replace(',', '.');

    containers.push({
      containernummer,
      containertype: typeInfo?.trim(),
      sealnummer: seal,
      gewicht,
      volume,
      omschrijving
    });

    i++; // skip volgende regel
  }

  return containers;
}




export default async function parseDFDS(pdfBuffer) {
  const { text } = await pdfParse(pdfBuffer);
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);

  console.log('🧾 Aantal regels in PDF:', lines.length);
  console.log('📄 Eerste 30 regels:\n', lines.slice(0, 30).join('\n'));

  return { lines }; // tijdelijk — puur ter inspectie
}