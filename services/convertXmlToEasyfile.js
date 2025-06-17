// 📁 services/convertXmlToEasyfile.js

import fs from 'fs';
import path from 'path';

export function convertXmlToEasyfile(xml, reference, laadplaats) {
  const filename = `Order_${reference}_${laadplaats}.easy`;
  const tempDir = '/tmp';
  const filePath = path.join(tempDir, filename);

  fs.writeFileSync(filePath, xml);
  return { filename, filePath };
}