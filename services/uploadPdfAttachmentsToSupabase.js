// 📁 services/uploadPdfAttachmentsToSupabase.js
import '../utils/fsPatch.js';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import parsePdfToJson from './parsePdfToJson.js';
import { generateXmlFromJson } from './generateXmlFromJson.js';

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

export async function uploadPdfAttachmentsToSupabase(attachments, referentie) {
  const uploadedFiles = [];
  const verwerkteBestanden = new Set();
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
  if (verwerkteBestanden.has(att.filename)) {
  console.log(`⏭️ Bestand ${att.filename} is al verwerkt, wordt overgeslagen`);
  continue;
  }
verwerkteBestanden.add(att.filename);
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

     const isPdf = att.contentType?.includes('pdf') || att.filename.toLowerCase().endsWith('.pdf');
    const fileName = att.ritnummer && att.ritnummer !== '0' && isPdf
      ? `${att.ritnummer}.pdf`
      : att.filename;

    try {
      console.log(`📤 Upload naar Supabase: ${fileName}`);
      const juisteBucket = att.filename.endsWith('.easy') ? 'easyfiles' : 'inboxpdf';

      const { error } = await supabase
        .storage
        .from(juisteBucket)
        .upload(fileName, contentBuffer, {
          contentType: att.contentType || 'application/octet-stream',
          upsert: true
        });

      if (error) {
        const msg = `❌ Supabase upload error: ${error.message}`;
        console.error(msg);
        await notifyError(att, msg);
        continue;
      }

      uploadedFiles.push({
        filename: fileName,
        url: `${process.env.SUPABASE_URL}/storage/v1/object/public/${juisteBucket}/${fileName}`
      });

    } catch (err) {
      const msg = `❌ Uploadfout: ${err.message}`;
      console.error(msg);
      await notifyError(att, msg);
      continue;
    }
    if (alVerwerkt.has(att.filename)) {
    console.log(`⏭️ ${att.filename} is al verwerkt, wordt overgeslagen`);
    continue;
    }
    alVerwerkt.add(att.filename);

    // Alleen voor PDF-bestanden → parse + reprocess
    if (isPdf) {
      try {
        const json = await parsePdfToJson(contentBuffer);
        if (!json || Object.keys(json).length === 0) throw new Error('Parser gaf geen bruikbare data terug');

        const xml = await generateXmlFromJson(json);
        const xmlBase64 = Buffer.from(xml).toString('base64');

        const payload = {
          ...json,
          reference: json.referentie || json.reference || 'Onbekend',
          ritnummer: json.ritnummer || '0',
          laadplaats: json.laadplaats || json.klantplaats || '0',
          xmlBase64,
          pdfBestandsnaam: att.filename
        };

        // ✅ Alleen 1 fetch — geen dubbele trigger!
        if (!att.skipReprocessing) {
          console.log('📡 Versturen naar generate-easy-files:', payload.reference);
          await fetch(`${process.env.PUBLIC_URL}/api/generate-easy-files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (verwerkteBestanden.has(att.filename)) {
          console.log(`⏭️ Bestand ${att.filename} is al verwerkt, wordt overgeslagen`);
          continue;
          }
          verwerkteBestanden.add(att.filename);
        }

      } catch (err) {
        const msg = `⚠️ Easy-bestand fout: ${err.message}`;
        console.error(msg);
        await notifyError(att, msg);
      }
    }
  }

  return uploadedFiles;
}