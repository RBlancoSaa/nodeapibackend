// parseEasyXml.js
import fs from 'fs/promises';
import { parseStringPromise } from 'xml2js';

async function inspectEasy(filePath) {
  try {
    const xml = await fs.readFile(filePath, 'utf8');
    const json = await parseStringPromise(xml, { explicitArray: false });
    console.log(`\n==== ${filePath} ====`);
    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error(`Error parsing ${filePath}:`, err.message);
  }
}

(async () => {
  // Zet hier de bestandsnamen van je .easy-files
  const files = [
  './tmp/Order_56384.easy'
];
  for (const f of files) {
    await inspectEasy(f);
  }
})();