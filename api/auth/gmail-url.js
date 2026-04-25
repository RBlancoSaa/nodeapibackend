// api/auth/gmail-url.js — tijdelijk, verwijder na gebruik
import { google } from 'googleapis';

export default function handler(req, res) {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    `${process.env.PUBLIC_URL || 'https://nodeapibackend.vercel.app'}/api/auth/gmail-callback`
  );

  const url = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://mail.google.com/']
  });

  res.status(200).json({ url });
}
