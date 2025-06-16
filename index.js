import express from 'express';
import dotenv from 'dotenv';
import { ImapFlow } from 'imapflow';
import path from 'path';
import fs from 'fs/promises';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { uploadPdfAttachmentsToSupabase } from './services/uploadPdfAttachmentsToSupabase.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // of anon key als je wilt
const supabase = createClient(supabaseUrl, supabaseKey);

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/check-inbox', async (req, res) => {
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
    for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true })) {
      const pdfParts = [];

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
    }

    await client.logout();

    res.status(200).json({ success: true, mails });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message || 'Onbekende fout' });
  }
});

app.listen(PORT, () => {
  console.log(`Server draait op poort ${PORT}`);
});