// .uploadPdfAttachmentsToSupabas.js
import '../utils/fsPatch.js';                      // 🚫 patch fs vóór pdf-parse
import { createClient } from '@supabase/supabase-js';
import parsePdfToJson from './parsePdfToJson.js';
import { generateXmlFromJson } from './generateXmlFromJson.js';
import fetch from 'node-fetch';
import nodemailer from 'nodemailer';

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

export async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

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

    if (!att.filename) {
      const msg = `⛔ Ongeldige bestandsnaam`;
      console.error(msg);
      await notifyError(att, msg);
      continue;
    }

    if (!att.filename.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Niet geüpload (geen .pdf): ${att.filename}`);
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

    // Upload naar Supabase
    try {
      console.log(`📤 Upload naar Supabase: ${att.filename}`);
      const { error } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(att.filename, contentBuffer, {
          contentType: att.contentType || 'application/pdf',
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        const msg = `❌ Uploadfout: ${error.message}`;
        console.error(msg);
        await notifyError(att, msg);
        continue;
      }

      console.log(`✅ Upload gelukt: ${att.filename}`);

      // PDF -> .easy genereren
      let json;
let xml;

try {
  console.log(`📘 Start parser naar JSON`);
  json = await parsePdfToJson(contentBuffer);
  if (!json || Object.keys(json).length === 0) {
    throw new Error('Parser gaf geen bruikbare data terug');
  }

  console.log(`🛠️ XML genereren uit JSON`);
  xml = await generateXmlFromJson(json);
} catch (err) {
  const msg = `⚠️ Parserfout: ${err.message}`;
  console.error(msg);
  await notifyError(att, msg);
  continue;
}

      // xml → generate-easy-files POST
      const referenceMatch = xml.match(/<Klantreferentie>(.*?)<\/Klantreferentie>/);
      const laadplaatsMatch = xml.match(/<Naam>(.*?)<\/Naam>/);
      const xmlBase64 = Buffer.from(xml).toString('base64');

const laadplaats = json.laadplaats || '0';
const reference = json.referentie || 'Onbekend';
const payload = {
  ...json,
  reference,
  laadplaats
};

console.log('📡 Versturen naar generate-easy-files', {
  xmlBase64,
  reference,
  laadplaats,
  url: `${process.env.PUBLIC_URL}/api/generate-easy-files`
});

await fetch(`${process.env.PUBLIC_URL}/api/generate-easy-files`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

      uploadedFiles.push({
        filename: att.filename,
        url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${att.filename}`
      });

    } catch (err) {
      const msg = `💥 Upload/parsing crash: ${err.message || err}`;
      console.error(msg);
      await notifyError(att, msg);
    }
  }

  return uploadedFiles;
}