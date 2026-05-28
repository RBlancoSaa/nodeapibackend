// services/sendViaAhqEdge.js
//
// Verstuurt email via de AutomatingHQ Supabase Edge Function `verstuur-email`,
// die Gmail SMTP gebruikt met een app-password. Dit is robuuster dan de
// OAuth-refresh-token flow in nodeapibackend (die elke ~7 dagen verloopt als
// de Google OAuth-app in "Testing" mode staat).
//
// De anon-key is een publishable key (veilig om in code te staan); de
// SMTP-credentials zelf zitten als secrets in de edge function. Te overriden
// via env-vars AHQ_EMAIL_FN_URL / AHQ_EMAIL_FN_KEY indien gewenst.

const DEFAULT_FN_URL = 'https://ojzihjiypprhwnxmnosr.supabase.co/functions/v1/verstuur-email';
const DEFAULT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9qemloaml5cHByaHdueG1ub3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzg3NzQsImV4cCI6MjA5MzY1NDc3NH0.cAfxwRQanVKDFJv-CE75zbWxPm5Ndqb6dAZ3irbe0WM';

/**
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string} opts.subject
 * @param {string} [opts.text]
 * @param {string} [opts.html]
 * @param {Array<{filename:string, content:Buffer, contentType?:string}>} [opts.attachments]
 * @param {string} [opts.replyTo]
 */
export async function sendViaAhqEdge({ to, subject, text, html, attachments = [], replyTo }) {
  const url = process.env.AHQ_EMAIL_FN_URL || DEFAULT_FN_URL;
  const key = process.env.AHQ_EMAIL_FN_KEY || DEFAULT_ANON_KEY;

  const payload = {
    to,
    subject,
    text,
    html,
    reply_to: replyTo,
    attachments: attachments.map(a => ({
      filename: a.filename,
      content_base64: Buffer.isBuffer(a.content)
        ? a.content.toString('base64')
        : Buffer.from(a.content || '').toString('base64'),
      content_type: a.contentType || 'application/octet-stream',
    })),
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'apikey': key,
    },
    body: JSON.stringify(payload),
  });

  const tekst = await resp.text();
  let body;
  try { body = JSON.parse(tekst); } catch { body = { raw: tekst }; }

  if (!resp.ok || body?.error) {
    throw new Error(`AHQ verstuur-email faalde (${resp.status}): ${body?.error || tekst}`);
  }
  return body;
}
