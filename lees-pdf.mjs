// Tijdelijk script om PDF-structuur te lezen
// Gebruik: node lees-pdf.mjs transport_285404.pdf
import pdfParse from 'pdf-parse';
import fs from 'fs';

const bestand = process.argv[2];
if (!bestand) { console.log('Gebruik: node lees-pdf.mjs bestandsnaam.pdf'); process.exit(1); }

const buffer = fs.readFileSync(bestand);
const { text } = await pdfParse(buffer);
const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

console.log(`\n📄 ${bestand} — ${regels.length} regels\n`);
regels.forEach((r, i) => console.log(`[${i}] ${r}`));
