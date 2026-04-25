// api/auth/gmail-callback.js — tijdelijk, verwijder na gebruik
import { google } from 'googleapis';

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send('Geen code ontvangen');

  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    `${process.env.PUBLIC_URL || 'https://nodeapibackend.vercel.app'}/api/auth/gmail-callback`
  );

  const { tokens } = await auth.getToken(code);

  res.status(200).send(`
    <h2>✅ Gmail OAuth2 geslaagd!</h2>
    <p><strong>Kopieer deze GMAIL_REFRESH_TOKEN naar Vercel:</strong></p>
    <textarea rows="4" cols="80" onclick="this.select()">${tokens.refresh_token || '(geen refresh token — probeer opnieuw met prompt=consent)'}</textarea>
    <p>Scope: ${tokens.scope}</p>
    <p>Daarna: sla op in Vercel → Environment Variables → GMAIL_REFRESH_TOKEN, en redeploy.</p>
  `);
}
