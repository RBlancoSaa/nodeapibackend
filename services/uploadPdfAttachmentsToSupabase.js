import { createClient } from '@supabase/supabase-js';
import { parsePdfToEasyFile } from './parsePdfToEasyFile.js';
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
      .replace(/[^\x00-\x7F]/g, '') // verwijder niet-ASCII
      .replace(/[^\w\d\-_.]/g, '_') // ongewenste tekens vervangen
      .replace(/_+/g, '_')          // meerdere underscores naar één
      .replace(/^_+|_+$/g, '')      // underscores begin/eind verwijderen
  }));

  for (const att of sanitizedAttachments) {
    console.log(`📥 Start verwerking voor: ${att.originalFilename}`);

    if (!att.filename) {
      console.error(`⛔ Ongeldige bestandsnaam:`, {
        origineleNaam: att.originalFilename,
        gesanitizedNaam: att.filename
      });
      const msg = `Lege bestandsnaam na sanitizen!`;
      await notifyError(att, msg);
      continue;
    }

    if (!att.filename.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Bestand overgeslagen (geen .pdf): ${att.filename}`);
      continue;
    }

    console.log(`🧾 Bestandsnaam: ${att.originalFilename} → ${att.filename}`);

    let contentBuffer;
    try {
      if (Buffer.isBuffer(att.content)) {
        contentBuffer = att.content;
      } else if (att.content instanceof Uint8Array) {
        contentBuffer = Buffer.from(att.content);
      } else if (att.content instanceof ArrayBuffer) {
        contentBuffer = Buffer.from(new Uint8Array(att.content));
      } else {
        throw new Error('Attachment content is not een buffer');
      }
    } catch (err) {
      const msg = `Buffer error: ${err.message}`;
      console.error(`❌ ${msg}`);
      await notifyError(att, msg);
      continue;
    }

    if (!contentBuffer?.length) {
      const msg = `Lege buffer voor ${att.filename}`;
      console.error(`⛔ ${msg}`);
      await notifyError(att, msg);
      continue;
    }

    try {
      console.log(`📤 Upload naar Supabase gestart: ${att.filename}`);
      const { error } = await supabase.storage
        .from(process.env.SUPABASE_BUCKET)
        .upload(att.filename, contentBuffer, {
          contentType: att.contentType || 'application/pdf',
          cacheControl: '3600',
          upsert: true,
        });

      if (error) {
        const msg = `Uploadfout: ${error.message}`;
        console.error(`❌ ${msg}`);
        await notifyError(att, msg);
        continue;
      }

      console.log(`✅ Upload gelukt: ${att.filename}`);
      console.log(`🧠 Parser gestart voor: ${att.filename}`);

      let xml;
      try {
        xml = await parsePdfToEasyFile(contentBuffer);
      } catch (err) {
        const msg = `Parserfout: ${err.message}`;
        console.error(`⚠️ ${msg}`);
        await notifyError(att, msg);
        continue;
      }

const referenceMatch = xml.match(/<Klantreferentie>(.*?)<\/Klantreferentie>/);
const laadplaatsMatch = xml.match(/<Naam>(.*?)<\/Naam>/);
const reference = referenceMatch?.[1] || 'Onbekend';
const laadplaats = laadplaatsMatch?.[1] || 'Onbekend';

const payload = {
  xmlBase64: Buffer.from(xml).toString('base64'),
  reference,
  laadplaats
};

console.log("📤 Versturen naar generate-easy-files met body:", JSON.stringify(payload, null, 2));

const resp = await fetch(`${process.env.PUBLIC_URL}/api/generate-easy-files`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});

      const responseText = await resp.text();
      console.log("📥 Response van generate-easy-files:", responseText);

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (e) {
        result = { success: false, message: 'Kon response niet parsen als JSON' };
      }

      if (!result.success) {
        const msg = `generate-easy-files response: ${result.message}`;
        console.error(`⚠️ ${msg}`);
        await notifyError(att, msg);
      } else {
        console.log(`✅ .easy gegenereerd: ${result.fileName}`);
      }

      uploadedFiles.push({
        filename: att.filename,
        url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${att.filename}`
      });
    } catch (err) {
      const msg = `Upload/parsing fout: ${err.message || err}`;
      console.error(`💥 ${msg}`);
      await notifyError(att, msg);
    }
  }

  return uploadedFiles;
}