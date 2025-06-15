import { ImapFlow } from 'imapflow';
import path from 'path';
import fs from 'fs/promises';
import nodemailer from 'nodemailer';

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
    for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true })) {
      // ...zelfde logica zoals pdf zoeken etc...
    }

    await client.logout();

    // Response teruggeven
    res.status(200).json({ success: true, mails });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message || 'Onbekende fout' });
  }
}
