// api/test-gmail-auth.js  — tijdelijk debug endpoint, verwijder na gebruik
import { google } from 'googleapis';

export default async function handler(req, res) {
  const vars = {
    GMAIL_USER:          !!process.env.GMAIL_USER,
    GMAIL_CLIENT_ID:     !!process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN: !!process.env.GMAIL_REFRESH_TOKEN
  };

  const missing = Object.entries(vars).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    return res.status(500).json({ ok: false, probleem: 'Ontbrekende variabelen', missing });
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const { token } = await auth.getAccessToken();

    // Check what scopes this token actually has
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
    const tokenInfo = await tokenInfoRes.json();

    // Try a real Gmail API call
    const gmail = google.gmail({ version: 'v1', auth });
    let gmailTest = null;
    try {
      const r = await gmail.users.getProfile({ userId: 'me' });
      gmailTest = { ok: true, email: r.data.emailAddress };
    } catch (e) {
      gmailTest = { ok: false, fout: e.message };
    }

    return res.status(200).json({
      ok: true,
      gmail_user: process.env.GMAIL_USER,
      client_id_preview: process.env.GMAIL_CLIENT_ID?.slice(0, 30) + '...',
      token_preview: token?.slice(0, 20) + '...',
      token_scope: tokenInfo.scope,
      token_email: tokenInfo.email,
      gmail_api_test: gmailTest
    });
  } catch (err) {
    return res.status(500).json({ ok: false, probleem: err.message });
  }
}
