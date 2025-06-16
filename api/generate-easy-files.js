import fs from 'fs';
import path from 'path';
import { parsePdf } from '../services/parsePdf.js';
import { buildEasyXml } from '../services/buildEasyXml.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const inboxDir = path.join(process.cwd(), 'inboxpdf');
    const outputDir = path.join(process.cwd(), 'easyfiles');

    // Zorg dat outputmap bestaat
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    const files = fs.readdirSync(inboxDir).filter((f) => f.endsWith('.pdf'));

    const results = [];

    for (const file of files) {
      const pdfPath = path.join(inboxDir, file);
      const pdfBuffer = fs.readFileSync(pdfPath);

      const parsedData = await parsePdf(pdfBuffer, file);
      if (!parsedData || !parsedData.referentie) {
        console.warn(`❌ Parserfout of geen referentie voor ${file}`);
        continue;
      }

      const easyXml = buildEasyXml(parsedData);
      const outputName = `Order_${parsedData.referentie}_Rotterdam.easy`;
      const outputPath = path.join(outputDir, outputName);

      fs.writeFileSync(outputPath, easyXml, 'utf8');

      results.push(outputName);
      console.log(`✅ .easy-bestand opgeslagen: ${outputName}`);
    }

    res.status(200).json({
      success: true,
      generated: results.length,
      files: results,
    });
  } catch (err) {
    console.error('💥 Fout bij generate-easy-files:', err.message);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}