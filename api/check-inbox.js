// 📁 automatinglogistics-api/api/check-inbox.js

import { ImapFlow } from 'imapflow';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { findPDFs } from '../services/pdfService.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

    let uids = await client.search({ seen: false });
    uids = uids.sort((a, b) => b - a).slice(0, 15); // verwerk max 15 nieuwste ongelezen mails
    if (uids.length === 0) {
      await client.logout();
      return res.status(200).json({ success: true, mails: [], uploadedFiles: [] });
    }

    const mails = [];
    const uploadedFiles = [];

    for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true })) {
      const pdfParts = await findPDFs(message.bodyStructure, client, message.uid);

      mails.push({
        uid: message.uid,
        subject: message.envelope.subject || '(geen onderwerp)',
        from: message.envelope.from.map(f => `${f.name ?? ''} <${f.address}>`.trim()).join(', '),
        date: message.envelope.date,
        pdfParts,
      });

      for (const part of pdfParts) {
        const filename = `pdf-${message.uid}-${part.part.replace(/\s+/g, '_')}`;

        const { data, error } = await supabase.storage
          .from('pdf-attachments')
          .upload(filename, part.buffer, {
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
          url: `${process.env.SUPABASE_URL}/storage/v1/object/public/pdf-attachments/${filename}`,
        });
      }
    }

    await client.logout();

    res.status(200).json({ success: true, mails, uploadedFiles });
  } catch (error) {
    console.error('CheckInbox error:', error);
    res.status(500).json({ success: false, error: error.message || 'Onbekende fout' });
  }
}