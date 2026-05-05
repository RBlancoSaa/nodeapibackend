// api/test-send-email.js — diagnostisch endpoint om Gmail verzenden te testen
// Gebruik: GET /api/test-send-email?to=jouw@email.nl
// Verwijder na gebruik of beveilig met een secret parameter

import { google } from 'googleapis';
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ontvanger = req.query.to || process.env.RECIPIENT_EMAIL;
  if (!ontvanger) {
    return res.status(400).json({ error: 'Geef ?to=emailadres mee of stel RECIPIENT_EMAIL in' });
  }

  const stappen = [];

  // ── Stap 1: env vars aanwezig? ────────────────────────────────────────────
  const envVars = {
    GMAIL_CLIENT_ID:     !!process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: !!process.env.GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN: !!process.env.GMAIL_REFRESH_TOKEN,
    GMAIL_USER:          process.env.GMAIL_USER || '(niet ingesteld)',
    RECIPIENT_EMAIL:     process.env.RECIPIENT_EMAIL || '(niet ingesteld)'
  };
  stappen.push({ stap: 'env_vars', ok: !!(envVars.GMAIL_CLIENT_ID && envVars.GMAIL_CLIENT_SECRET && envVars.GMAIL_REFRESH_TOKEN), data: envVars });

  // ── Stap 2: OAuth token ophalen + scopes controleren ─────────────────────
  let auth, accessToken, scopes;
  try {
    auth = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

    const tokenResult = await auth.getAccessToken();
    accessToken = tokenResult.token;

    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`);
    const tokenInfo = await tokenInfoRes.json();
    scopes = tokenInfo.scope || '';

    stappen.push({
      stap: 'oauth_token',
      ok: true,
      email: tokenInfo.email,
      scopes,
      heeftSendScope: scopes.includes('gmail.send') || scopes.includes('mail.google.com'),
      heeftModifyScope: scopes.includes('gmail.modify') || scopes.includes('mail.google.com')
    });
  } catch (err) {
    stappen.push({ stap: 'oauth_token', ok: false, fout: err.message });
    return res.status(200).json({ ok: false, stappen });
  }

  // ── Stap 3: Gmail profiel ophalen (test read) ─────────────────────────────
  try {
    const gmail = google.gmail({ version: 'v1', auth });
    const profiel = await gmail.users.getProfile({ userId: 'me' });
    stappen.push({ stap: 'gmail_read', ok: true, emailAddress: profiel.data.emailAddress, messagesTotal: profiel.data.messagesTotal });
  } catch (err) {
    stappen.push({ stap: 'gmail_read', ok: false, fout: err.message });
  }

  // ── Stap 4: Nodemailer message bouwen ─────────────────────────────────────
  let rawBuffer;
  try {
    rawBuffer = await new Promise((resolve, reject) => {
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
      transport.sendMail({
        from: process.env.GMAIL_USER || 'noreply@example.com',
        to: ontvanger,
        subject: '✅ EasyTrip test email — Gmail API werkt!',
        text: `Dit is een testbericht van de EasyTrip Automator.\n\nAls je dit bericht ontvangt, werkt de Gmail API verzending correct.\n\nVerstuurd op: ${new Date().toISOString()}`
      }, (err, info) => {
        if (err) return reject(err);
        if (!info || !info.message) return reject(new Error('Geen message in info'));
        if (Buffer.isBuffer(info.message)) {
          resolve(info.message);
        } else if (typeof info.message.pipe === 'function') {
          const chunks = [];
          info.message.on('data', c => chunks.push(c));
          info.message.on('end', () => resolve(Buffer.concat(chunks)));
          info.message.on('error', reject);
        } else {
          reject(new Error(`Onverwacht message-type: ${typeof info.message}`));
        }
      });
    });
    stappen.push({ stap: 'nodemailer_build', ok: true, messageSize: rawBuffer.length, preview: rawBuffer.toString('utf8').slice(0, 200) });
  } catch (err) {
    stappen.push({ stap: 'nodemailer_build', ok: false, fout: err.message });
    return res.status(200).json({ ok: false, stappen });
  }

  // ── Stap 5: Gmail API messages.send aanroepen ─────────────────────────────
  try {
    const raw = rawBuffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const gmail = google.gmail({ version: 'v1', auth });
    const result = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });

    stappen.push({
      stap: 'gmail_send',
      ok: true,
      gmailMessageId: result.data.id,
      labelIds: result.data.labelIds,
      threadId: result.data.threadId
    });
  } catch (err) {
    stappen.push({
      stap: 'gmail_send',
      ok: false,
      fout: err.message,
      status: err.status,
      code: err.code,
      errors: err.errors || null
    });
    return res.status(200).json({ ok: false, stappen });
  }

  const alleOk = stappen.every(s => s.ok);
  return res.status(200).json({
    ok: alleOk,
    bericht: alleOk
      ? `✅ Test email verstuurd naar ${ontvanger} — controleer je inbox`
      : '❌ Er is een probleem gevonden — zie stappen voor details',
    ontvanger,
    stappen
  });
}
