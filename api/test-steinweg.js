// 📁 api/test-steinweg.js  — alleen voor testen, niet voor productie
import '../utils/fsPatch.js';
import { createClient } from '@supabase/supabase-js';
import parseSteinweg from '../parsers/parseSteinweg.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';

let _supabase;
function getSupabase() {
  return _supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function downloadXlsx(filename) {
  const { data, error } = await getSupabase()
    .storage
    .from('inboxpdf')
    .download(filename);
  if (error) throw new Error(`Download mislukt: ${filename} — ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { route1, route2, emailBody, emailSubject } = req.query;

  if (!route1) {
    return res.status(400).json({
      error: 'Geef minstens ?route1=bestandsnaam.xlsx mee',
      voorbeeld: '/api/test-steinweg?route1=PickupNotice_Route1_24-04-2026%20083055.xlsx&route2=PickupNotice_Route2_24-04-2026%20083112.xlsx'
    });
  }

  try {
    const route1Buffer = await downloadXlsx(route1);
    const route2Buffer = route2 ? await downloadXlsx(route2) : null;

    console.log('🧪 Test parseSteinweg gestart...');
    const containers = await parseSteinweg({
      route1Buffer,
      route2Buffer,
      emailBody:    emailBody    || 'Hi, Graag 28-04 /29-4 overrijden.',
      emailSubject: emailSubject || 'Test Steinweg order'
    });

    if (!containers || containers.length === 0) {
      return res.status(200).json({ success: false, message: 'Parser gaf geen containers terug', containers: [] });
    }

    // Probeer ook XML te genereren voor de eerste container als check
    let xmlPreview = null;
    let xmlError   = null;
    try {
      xmlPreview = await generateXmlFromJson({ ...containers[0] });
      xmlPreview = xmlPreview.slice(0, 800) + '\n...(ingekort)';
    } catch (e) {
      xmlError = e.message;
    }

    return res.status(200).json({
      success: true,
      aantalContainers: containers.length,
      containers: containers.map(c => ({
        containernummer:   c.containernummer,
        containertype:     c.containertype,
        datum:             c.datum,
        zegel:             c.zegel,
        lading:            c.lading,
        brutogewicht:      c.brutogewicht,
        referentie:        c.referentie,
        laadreferentie:    c.laadreferentie,
        inleverreferentie: c.inleverreferentie,
        rederij:           c.rederij,
        instructies:       c.instructies?.slice(0, 100),
        locaties: c.locaties.map(l => ({ actie: l.actie, naam: l.naam, adres: l.adres, postcode: l.postcode, plaats: l.plaats }))
      })),
      xmlPreview,
      xmlError
    });
  } catch (err) {
    console.error('❌ test-steinweg fout:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
