// handlers/handleDFDS.js
import parseDFDS from '../parsers/parseDFDS.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { uploadEasyFileToSupabase } from '../services/uploadEasyFileToSupabase.js';
import { logResult } from '../utils/log.js';

export default async function handleDFDS(pdfBuffer, filename) {
  try {
    console.log(`📥 Verwerken gestart voor: ${filename}`);

    const containers = await parseDFDS(pdfBuffer);
    if (!containers || containers.length === 0) {
      throw new Error('❌ Geen containers gevonden in DFDS-opdracht.');
    }

    const resultaten = [];

    for (const containerData of containers) {
      const data = { ...containerData };

      // Gebruik alleen containertypeCode als geldig
      if (!data.containertype && data.containertypeCode && data.containertypeCode !== '0') {
        data.containertype = data.containertypeCode;
      }

      // Logging per veld
      Object.entries(data).forEach(([key, val]) => logResult(key, val));

      // .easy-bestandsnaam
      const safeLaadplaats = (data.locaties?.[0]?.plaats || 'Onbekend').replace(/\s+/g, '');
      const bestandsnaam = `Order_${data.referentie || 'GEENREF'}_${safeLaadplaats}.easy`;

      // Genereer XML
      const xml = generateXmlFromJson(data);
      console.log(typeof xml);
      console.log(xml);

      // Upload naar Supabase
      await uploadEasyFileToSupabase({
        filename: bestandsnaam,
        fileContent: xml,
        originalPdfName: filename,
      });

      resultaten.push({
        bestandsnaam,
        referentie: data.referentie,
        containernummer: data.containernummer,
      });

      console.log(`✅ Verwerkt: ${bestandsnaam}`);
    }

    return resultaten;
  } catch (error) {
    console.error(`❌ Fout bij verwerken DFDS-opdracht ${filename}:`, error.message);
    throw error;
  }
}