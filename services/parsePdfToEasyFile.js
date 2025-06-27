import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { parseJordex } from './parsers/parseJordex.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function (path, ...args) {
  if (typeof path === 'string' && path.includes('05-versions-space.pdf')) {
    console.warn('⛔️ Testbestand geblokkeerd:', path);
    return Buffer.from('');
  }
  return originalReadFileSync.call(this, path, ...args);
};

export async function parsePdfToEasyFile(pdfBuffer) {
  return await parseJordex(pdfBuffer);
}
