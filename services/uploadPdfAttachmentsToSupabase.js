// services/uploadPdfAttachmentsToSupabase.js
import '../utils/fsPatch.js';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import parsePdfToJson from './parsePdfToJson.js'; 
import { generateXmlFromJson } from './generateXmlFromJson.js'; // let op: met accolades!


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function notifyError(att, reason) {
  const meta = att.emailMeta || {};
  const subject = `🚨 Fout bij verwerken van ${att.filename || 'onbekend bestand'}`;
  const body = `Bestand: ${att.originalFilename || att.filename || 'Onbekend'}
Gesanitized: ${att.filename || 'Onbekend'}
Afzender: ${meta.from || 'Onbekend'}
Onderwerp: ${meta.subject || 'Onbekend'}
Binnenkomst: ${meta.received || 'Onbekend'}

Bijlagen in e-mail:
${(meta.attachments || []).join('\n')}

Foutmelding:
${reason}`;

  await transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to: process.env.FROM_EMAIL,
    subject,
    text: body
  });
}

/**
 * Uploadt PDF-attachments naar Supabase onder de naam <referentie>.pdf,
 * en stuurt daarna Json→XML→.easy–generator aan.
 *
 * @param {Array<{ filename: string, content: Buffer|Uint8Array|ArrayBuffer, contentType?: string, emailMeta?: object }>} attachments
 * @param {string} referentie
 * @returns {Promise<Array<{ filename: string, url: string }>>}
 */

export async function uploadPdfAttachmentsToSupabase(attachments, referentie) {
  const uploadedFiles = [];

  // Stap 1: sanitize bestandsnamen
  const sanitizedAttachments = attachments.map(att => ({
    ...att,
    originalFilename: att.filename,
    filename: att.filename
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[^\w\d\-_.]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
  }));

  for (const att of sanitizedAttachments) {
    console.log(`\n📥 Verwerken gestart voor: ${att.originalFilename}`);

    if (!att.filename.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Niet geüpload (geen PDF): ${att.filename}`);
      continue;
    }

    let contentBuffer;
    try {
      if (Buffer.isBuffer(att.content)) {
        contentBuffer = att.content;
      } else if (att.content instanceof Uint8Array) {
        contentBuffer = Buffer.from(att.content);
      } else if (att.content instanceof ArrayBuffer) {
        contentBuffer = Buffer.from(new Uint8Array(att.content));
      } else {
        throw new Error('Attachment is geen geldige buffer');
      }
    } catch (err) {
      const msg = `❌ Buffer fout: ${err.message}`;
      console.error(msg);
      await notifyError(att, msg);
      continue;
    }

    if (!contentBuffer?.length) {
      const msg = `⛔ Lege buffer`;
      console.error(msg);
      await notifyError(att, msg);
      continue;
    }
   
    
    // Stap 3: upload naar Supabase met referentie-naam
let fileName = `${referentie}.pdf`;
try {
  console.log(`📤 Upload naar Supabase: ${fileName}`);
  const { error } = await supabase.storage
    .from(process.env.SUPABASE_BUCKET)
    .upload(fileName, contentBuffer, {
      contentType: att.contentType || 'application/pdf',
      cacheControl: '3600',
      upsert: true
    });
  if (error) throw error;
  console.log(`✅ Upload gelukt: ${fileName}`);

  // Stap 5: voeg URL terug (binnen dezelfde try)
  uploadedFiles.push({
    filename: fileName,
    url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${fileName}`
  });
} catch (err) {
  const msg = `❌ Uploadfout: ${err.message}`;
  console.error(msg);
  await notifyError(att, msg);
  continue;
}
try {
  const json = await parsePdfToJson(contentBuffer);
  if (!json || Object.keys(json).length === 0) throw new Error('Parser gaf geen bruikbare data terug');

  const xml = await generateXmlFromJson(json);
  const xmlBase64 = Buffer.from(xml).toString('base64');

  const payload = {
    ...json,
    reference: json.referentie || json.reference || 'Onbekend',
    laadplaats: json.laadplaats || json.klantplaats || '0',
    xmlBase64
  };

  console.log('📡 Versturen naar generate-easy-files:', payload.reference);
  await fetch(`${process.env.PUBLIC_URL}/api/generate-easy-files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

} catch (err) {
  const msg = `⚠️ Easy-bestand fout: ${err.message}`;
  console.error(msg);
  await notifyError(att, msg);
}

 // Stap 5: voeg URL terug
uploadedFiles.push({
  filename: fileName,
  url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${fileName}`
});
  }

  return uploadedFiles;
}