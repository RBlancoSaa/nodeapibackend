// 📁 utils/gmailTransport.js
import nodemailer from 'nodemailer';
import { google } from 'googleapis';

function getOAuth2Client() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return auth;
}

export function hasGmail() {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN &&
    process.env.GMAIL_USER
  );
}

export async function getGmailTransporter() {
  if (!hasGmail()) {
    throw new Error('Gmail OAuth2 niet geconfigureerd — stel GMAIL_* env vars in');
  }

  const auth = getOAuth2Client();
  const { token: accessToken } = await auth.getAccessToken();

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.GMAIL_USER,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
      accessToken
    }
  });

  return { transporter, from: process.env.GMAIL_USER };
}
