
js
Kopiëren
Bewerken
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
  const body = `Bestand: ${att.filename || 'geen naam'}
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

  const sanitizedAttachments = attachments.map(att => {
    let safe = att.filename || 'bijlage.pdf';
    if (Buffer.isBuffer(safe)) safe = safe.toString('utf8');
    safe = safe.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
    safe = safe.replace(/[^\w\d\-_.]/g, '_');
    safe = safe.replace(/_+/g, '_');
    safe = safe.replace(/^_+|_+$/g, '');
    if (!safe) safe = 'bijlage.pdf';
    return {
      ...att,
      originalFilename: att.filename,
      filename: safe
    };
  });

  for (const att of sanitizedAttachments) {
    if (!att.filename?.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Bestand overgeslagen (geen .pdf): ${att.filename}`);
      continue;
    }

    if (!att.filename) {
      const msg = `Lege bestandsnaam na sanitizen!`;
      console.error(`⛔ ${msg}`);
      await notifyError(att, msg);
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
        headers: { 'Content-Type': 'application/json' },
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