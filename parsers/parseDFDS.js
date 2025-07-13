// 📁 parsers/parseDFDS.js
import '../utils/fsPatch.js';
import pdfParse from 'pdf-parse';

function logResult(label, value) {
  console.log(`🔍 ${label}:`, value || '[LEEG]');
  return value;
}

function extractContainers(lines) {
  const containers = [];
  const startIdx = lines.findIndex(l => l.toLowerCase().includes('goederen informatie'));
  console.log('🔍 Startindex goederenblok:', startIdx);

  if (startIdx === -1) {
    console.log('⚠️ Geen "Goederen informatie" gevonden in regels');
    return [];
  }

  for (let i = startIdx + 1; i < lines.length - 1; i++) {
    const line1 = lines[i];
    const line2 = lines[i + 1];

    if (!line1.includes('Zegel:')) {
      console.log(`⏭️ Regel ${i} overgeslagen (geen Zegel):`, line1);
      continue;
    }

    console.log(`📦 Containerregel gevonden op regel ${i}:`, line1);
    console.log(`📝 Omschrijvingsregel op regel ${i + 1}:`, line2);

    const [containerLine, sealMatch] = line1.split('/ Zegel:');
    const [containernummer, ...typeParts] = containerLine.trim().split(' ');
    const typeInfo = typeParts.join(' ').trim();
    const seal = sealMatch?.trim();

    const omschrijvingMatch = line2?.match(/^(.*)\s+([\d.,]+)\s+kg\s+([\d.,]+)\s+m3$/i);

    if (!omschrijvingMatch) {
      console.log(`⚠️ Geen geldige omschrijving/gewicht/volume op regel ${i + 1}:`, line2);
      continue;
    }

    const omschrijving = omschrijvingMatch[1].trim();
    const gewicht = omschrijvingMatch[2].replace(',', '.');
    const volume = omschrijvingMatch[3].replace(',', '.');

    const result = {
      containernummer,
      containertype: typeInfo,
      sealnummer: seal,
      gewicht,
      volume,
      omschrijving
    };

    console.log(`✅ Geëxtraheerd containerobject:`, result);
    containers.push(result);

    i++; // skip extra regel
  }

  console.log('📦 Totaal aantal containers gevonden:', containers.length);
  return containers;
}

export default async function parseDFDS(pdfBuffer) {
  const { text } = await pdfParse(pdfBuffer);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  console.log('📄 Regels in PDF:', lines.length);
  const containers = extractContainers(lines);
  logResult('Aantal containers', containers.length);

  return {
    ritnummer: 'SFIM2500929', // tijdelijk hardcoded voor test
    containers
  };
}