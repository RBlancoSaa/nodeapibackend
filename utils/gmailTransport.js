// utils/gmailTransport.js
export { sendViaGmailApi as sendMail } from '../services/gmailApiService.js';

/** Ontvanger voor .easy bestanden — MOET via RECIPIENT_EMAIL omgevingsvariabele worden ingesteld */
export const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

export function hasGmail() {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN &&
    process.env.GMAIL_USER
  );
}

/**
 * Voegt de originele email-tekst toe aan een uitgaand bericht.
 * Wordt geïmporteerd door alle handlers zodat er geen dubbele code is.
 */
export function metOrigineel(tekst, bodyText) {
  if (!bodyText?.trim()) return tekst;
  return `${tekst}\n\n${'─'.repeat(50)}\nOriginele email:\n\n${bodyText.trim()}`;
}

// Backwards-compat: returns an object with sendMail that matches nodemailer API
export async function getGmailTransporter() {
  const { sendViaGmailApi } = await import('../services/gmailApiService.js');
  const from = process.env.GMAIL_USER;
  return {
    from,
    transporter: {
      sendMail: ({ from: f, to, subject, text, attachments }) =>
        sendViaGmailApi({ from: f || from, to, subject, text, attachments })
    }
  };
}
