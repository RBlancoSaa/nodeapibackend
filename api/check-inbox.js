// 📁 automatinglogistics-api/api/check-inbox.js

import { ImapFlow } from 'imapflow';                                              // 1
import { createClient } from '@supabase/supabase-js';                             // 2
import nodemailer from 'nodemailer';                                              // 3
import { findPDFs } from '../services/pdfService.js';                             // 4
                                                                                  // 5
const supabaseUrl = process.env.SUPABASE_URL;                                     // 6
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // uploadrechten       // 7
const supabase = createClient(supabaseUrl, supabaseKey);                          // 8
                                                                                  // 9
export default async function handler(req, res) {                                 // 10
  if (req.method !== 'GET') {                                                     // 11
    return res.status(405).json({ error: 'Method not allowed' });                 // 12
  }                                                                               // 13
                                                                                  // 14
  try {                                                                           // 15
    const client = new ImapFlow({                                                 // 16
      host: process.env.IMAP_HOST,                                                // 17
      port: Number(process.env.IMAP_PORT),                                        // 18
      secure: process.env.IMAP_SECURE === 'true',                                 // 19
      auth: {                                                                     // 20
        user: process.env.IMAP_USER,                                              // 21
        pass: process.env.IMAP_PASS,                                              // 22
      },                                                                          // 23
    });                                                                           // 24
                                                                                  // 25
    await client.connect();                                                       // 26
    await client.mailboxOpen('INBOX');                                            // 27
                                                                                  // 28
    const uids = await client.search({ seen: false });                            // 29
    if (uids.length === 0) {                                                      // 30
      await client.logout();                                                      // 31
      return res.status(200).json({ success: true, mails: [], uploadedFiles: [] });// 32
    }                                                                             // 33
                                                                                  // 34
    const mails = [];                                                             // 35
    const uploadedFiles = [];                                                     // 36
                                                                                  // 37
    for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true })) { // 38
      const pdfParts = await findPDFs(message.bodyStructure, client, message.uid); // 39
                                                                                  // 40
      mails.push({                                                                // 41
        uid: message.uid,                                                         // 42
        subject: message.envelope.subject || '(geen onderwerp)',                  // 43
        from: message.envelope.from.map(f => `${f.name ?? ''} <${f.address}>`.trim()).join(', '), // 44
        date: message.envelope.date,                                              // 45
        pdfParts,                                                                 // 46
      });                                                                         // 47
                                                                                  // 48
      for (const part of pdfParts) {                                              // 49
        const filename = `pdf-${message.uid}-${part.part.replace(/\s+/g, '_')}`;  // 50
                                                                                  // 51
        const { data, error } = await supabase.storage                            // 52
          .from('pdf-attachments')                                                // 53
          .upload(filename, part.buffer, {                                        // 54
            cacheControl: '3600',                                                 // 55
            upsert: true,                                                         // 56
            contentType: 'application/pdf',                                       // 57
          });                                                                     // 58
                                                                                  // 59
        if (error) {                                                              // 60
          console.error('Supabase upload error:', error);                         // 61
          continue;                                                               // 62
        }                                                                         // 63
                                                                                  // 64
        uploadedFiles.push({                                                      // 65
          filename,                                                               // 66
          url: `${process.env.SUPABASE_URL}/storage/v1/object/public/pdf-attachments/${filename}`, // 67
        });                                                                       // 68
      }                                                                           // 69
    }                                                                             // 70
                                                                                  // 71
    await client.logout();                                                        // 72
                                                                                  // 73
    // TODO: hier kan je straks .easy files genereren en versturen                // 74
    // Bijvoorbeeld: await generateAndSendEasyFiles(mails, uploadedFiles);        // 75
                                                                                  // 76
    res.status(200).json({ success: true, mails, uploadedFiles });                // 77
  } catch (error) {                                                               // 78
    console.error('CheckInbox error:', error);                                    // 79
    res.status(500).json({ success: false, error: error.message || 'Onbekende fout' }); // 80
  }                                                                               // 81
}                                                                                 // 82
                                                                                  // 83
// 📌 Deze versie behoudt exact de oorspronkelijke structuur                       // 84
// Alleen de loop is aangepast i.v.m. nieuw pdfParts-formaat                      // 85
// Totaal: 86 regels                                                              // 86