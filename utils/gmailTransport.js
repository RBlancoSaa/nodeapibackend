// 📁 utils/gmailTransport.js
import nodemailer from 'nodemailer';
import defaultTransporter from './smtpTransport.js';

let _gmailTransporter;

export function getGmailTransporter() {
  if (
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN &&
    process.env.GMAIL_USER
  ) {
    if (!_gmailTransporter) {
      _gmailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          type: 'OAuth2',
          user: process.env.GMAIL_USER,
          clientId: process.env.GMAIL_CLIENT_ID,
          clientSecret: process.env.GMAIL_CLIENT_SECRET,
          refreshToken: process.env.GMAIL_REFRESH_TOKEN
        }
      });
    }
    return { transporter: _gmailTransporter, from: process.env.GMAIL_USER };
  }
  return { transporter: defaultTransporter, from: process.env.FROM_EMAIL };
}

export function hasGmail() {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN &&
    process.env.GMAIL_USER
  );
}
