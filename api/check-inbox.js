// 📁 automatinglogistics-api/api/check-inbox.js
import '../utils/fsPatch.js';
import { ImapFlow } from 'imapflow';                                              // 1
import { createClient } from '@supabase/supabase-js';                             // 2
import nodemailer from 'nodemailer';                                              // 3
import { findAttachmentsAndUpload } from '../services/attachmentService.js';     // 4
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
    let uids = await client.search({ seen: false });                              // 29
    uids = uids.sort((a, b) => b - a).slice(0, 15);                                // 30
    if (uids.length === 0) {                                                      // 31
      await client.logout();                                                      // 32
      return res.status(200).json({ success: true, mails: [], uploadedFiles: [] });// 33
    }                                                                             // 34
                                                                                  // 35
    const { mails, uploadedFiles } = await findAttachmentsAndUpload(client, uids, supabase); // 36
                                                                                  // 37
    await client.logout();                                                        // 38
                                                                                  // 39
    res.status(200).json({ success: true, mails, uploadedFiles });                // 40
  } catch (error) {                                                               // 41
    console.error('CheckInbox error:', error);                                    // 42
    res.status(500).json({ success: false, error: error.message || 'Onbekende fout' }); // 43
  }                                                                               // 44
}                                                                                 // 45
                                                                                  // 46
// 📌 Deze versie verwerkt max 15 nieuwste ongelezen mails per run                // 47
// voorkomt Vercel timeouts en blijft schaalbaar voor grotere inboxen            // 48
