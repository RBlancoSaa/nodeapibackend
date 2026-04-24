// Tijdelijk script — haalt PDF op uit Supabase en toont de regelstructuur
// Gebruik: node lees-pdf.mjs transport_285404.pdf
import 'dotenv/config';
import pdfParse from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';

const bestand = process.argv[2];
if (!bestand) { console.log('Gebruik: node lees-pdf.mjs bestandsnaam.pdf'); process.exit(1); }

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await supabase.storage.from('inboxpdf').download(bestand);
if (error) { console.error('❌ Download mislukt:', error.message); process.exit(1); }

const buffer = Buffer.from(await data.arrayBuffer());
const { text } = await pdfParse(buffer);
const regels = text.split('\n').map(r => r.trim()).filter(Boolean);

console.log(`\n📄 ${bestand} — ${regels.length} regels\n`);
regels.forEach((r, i) => console.log(`[${i}] ${r}`));
