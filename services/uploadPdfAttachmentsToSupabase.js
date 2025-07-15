// 📁 services/uploadPdfAttachmentsToSupabase.js
import '../utils/fsPatch.js';
import { createClient } from '@supabase/supabase-js';
import parsePdfToJson from './parsePdfToJson.js';
import { generateXmlFromJson } from './generateXmlFromJson.js';
import { sendEmailWithAttachments } from './sendEmailWithAttachments.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


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

  const emailPerRit = new Map();
  const foutenPerRit = new Map();
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
          att.parsed = false;
          att.parseError = msg;
          continue;
      }

    if (!contentBuffer?.length) {
        const msg = `⛔ Lege buffer`;
        console.error(msg);
        att.parsed = false;
        att.parseError = msg;
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
            att.parsed = false;
            att.parseError = msg;
            continue;
          }

      if (att.filename.toLowerCase().endsWith('.pdf')) {
        uploadedFiles.push({
          filename: fileName,
          content: contentBuffer
        });
      }

    } catch (err) {
      const msg = `❌ Uploadfout: ${err.message}`;
      console.error(msg);
      att.parsed = false;
      att.parseError = msg;
      continue;
    }
    
      // Alleen voor PDF-bestanden → parse + reprocess
    if (isPdf) {
      try {
        const json = await parsePdfToJson(contentBuffer);
        att.parsed = true;
        if (!json || Object.keys(json).length === 0) throw new Error('Parser gaf geen bruikbare data terug');
        att.ritnummer = json.ritnummer || '';
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

          const easyBuffer = Buffer.from(xml, 'utf-8');
          const easyBestandsnaam = payload.ritnummer !== '0'
            ? `${payload.ritnummer}_${payload.laadplaats}.easy`
            : `${att.filename.replace('.pdf', '')}.easy`;

          verwerkteBestanden.add(att.filename);

          if (!emailPerRit.has(payload.ritnummer)) {
            emailPerRit.set(payload.ritnummer, []);
          }
          emailPerRit.get(payload.ritnummer).push(
            { filename: easyBestandsnaam, content: easyBuffer },
            { filename: att.filename, content: contentBuffer }
          );
      } catch (err) {
          const msg = `⚠️ Easy-bestand fout: ${err.message}`;
          console.error(msg);
          att.parsed = false;
          att.parseError = msg;

          if (!foutenPerRit.has(att.ritnummer || 'onbekend')) {
            foutenPerRit.set(att.ritnummer || 'onbekend', []);
          }
          foutenPerRit.get(att.ritnummer || 'onbekend').push({
            filename: att.filename,
            error: msg
          });
          continue;
      }
    }
  }
}
const failures = sanitizedAttachments.filter(a => !a.parsed);

if (failures.length) {
for (const [ritnummer, fouten] of foutenPerRit.entries()) {
  const lines = [
    '⚠️ Geen bijlages konden verwerkt worden als transportopdracht.',
    '',
    '---',
    '📎Bijlages die niet verwerkt konden worden:',
    ...fouten.map(f => `- ${f.filename}: ⚠️ ${f.error}`)
  ];

  await sendEmailWithAttachments({
    ritnummer,
    attachments: [],
    extraText: lines.join('\n')
  });
}
}

for (const [ritnummer, attachments] of emailPerRit.entries()) {
  await sendEmailWithAttachments({ ritnummer, attachments });
}
return {
  uploadedFiles,
  verwerkingsresultaten: sanitizedAttachments.map(att => ({
    filename: att.filename,
    parsed: att.parsed || false,
    ritnummer: att.ritnummer || '',
    reden: att.parseError || ''
  }))
};