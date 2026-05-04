// utils/gmailTransport.js
export { sendViaGmailApi as sendMail } from '../services/gmailApiService.js';

/** Standaard ontvanger voor .easy bestanden */
export const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || 'easybestanden@tiarotransport.nl';

export function hasGmail() {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN &&
    process.env.GMAIL_USER
  );
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
