import { ImapFlow } from 'imapflow';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service Role Key voor uploaden
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const client = new ImapFlow({
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT),
      secure: process.env.IMAP_SECURE === 'true',
      auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS,
      },
    });

    await client.connect();
    await client.mailboxOpen('INBOX');
    const uids = await client.search({ seen: false });

    if (uids.length === 0) {
      await client.logout();
      return res.status(200).json({ success: true, mails: [] });
    }

    const mails = [];
    const uploadedFiles = [];

    for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true })) {
      const pdfParts = [];

      // Recursief zoeken naar PDF attachments
      function findPDFs(structure) {
        if (
          structure.disposition?.type?.toUpperCase() === 'ATTACHMENT' &&
          structure.type === 'application' &&
          structure.subtype.toLowerCase() === 'pdf'
        ) {
          pdfParts.push(structure.part);
        }
        if (structure.childNodes) structure.childNodes.forEach(findPDFs);
        if (structure.parts) structure.parts.forEach(findPDFs);
      }
      if (message.bodyStructure) findPDFs(message.bodyStructure);

      mails.push({
        uid: message.uid,
        subject: message.envelope.subject || '(geen onderwerp)',
        from: message.envelope.from.map(f => `${f.name ?? ''} <${f.address}>`.trim()).join(', '),
        date: message.envelope.date,
        pdfParts,
      });

      // Upload PDF attachments naar Supabase
      for (const part of pdfParts) {
        const attachment = await client.download(message.uid, part);
        const filename = `pdf-${message.uid}-${part}.pdf`;

        const { data, error } = await supabase.storage
          .from('pdf-attachments') // jouw bucket naam
          .upload(filename, attachment, {
            cacheControl: '3600',
            upsert: true,
            contentType: 'application/pdf',
          });

        if (error) {
          console.error('Supabase upload error:', error);
          continue;
        }

        uploadedFiles.push({
          filename,
          url: `${process.env.SUPABASE_URL}/storage/v1/object/public/pdf-attachments/${filename}`
        });
      }
    }

    await client.logout();

    // Optioneel: stuur een mail met de geüploade bestanden als bijlage of link (kan je later toevoegen)

    res.status(200).json({ success: true, mails, uploadedFiles });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message || 'Onbekende fout' });
  }
}