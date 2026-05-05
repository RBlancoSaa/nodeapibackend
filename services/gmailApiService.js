// services/gmailApiService.js
import { google } from 'googleapis';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

function getGmailClient() {
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
}

export async function fetchUnreadMails() {
  const gmail = getGmailClient();

  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread in:inbox',
    maxResults: 50
  });

  const messages = data.messages || [];
  if (messages.length === 0) return { mails: [], allAttachments: [], ids: [] };

  const mails = [];
  const allAttachments = [];
  const ids = messages.map(m => m.id);

  for (const { id } of messages) {
    try {
      const { data: msg } = await gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'raw'
      });

      const raw = Buffer.from(msg.raw, 'base64url');
      const parsed = await simpleParser(raw);
      const attachments = parsed.attachments || [];

      // Skip test PDF
      if (attachments.some(a => a.filename === '05-versions-space.pdf')) {
        console.warn(`⛔ Testbestand genegeerd voor message ${id}`);
        continue;
      }

      const fromField = parsed.from?.text || '';
      const pdfAtt = attachments.find(a => a.filename?.toLowerCase().endsWith('.pdf'));

      mails.push({
        gmailId: id,
        subject: parsed.subject || '(geen onderwerp)',
        from: fromField,
        date: parsed.date,
        bodyText: parsed.text || '',
        source: raw,
        attachments: attachments.map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          content: a.content
        }))
      });

      allAttachments.push(...attachments.map(a => ({
        gmailId: id,
        filename: a.filename || 'bijlage',
        buffer: a.content,
        content: a.content,
        contentType: a.contentType,
        base64: a.content?.toString('base64') || ''
      })));

    } catch (err) {
      console.error(`❌ Fout bij ophalen message ${id}:`, err.message);
    }
  }

  return { mails, allAttachments, ids };
}

export async function sendViaGmailApi({ from, to, subject, text, attachments = [] }) {
  const gmail = getGmailClient();

  // Build raw RFC 2822 message using nodemailer streamTransport
  // Handles both Buffer and Stream returns (nodemailer v6 vs v7 differ)
  const rawBuffer = await new Promise((resolve, reject) => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    transport.sendMail({ from, to, subject, text, attachments }, (err, info) => {
      if (err) return reject(err);
      if (!info || !info.message) {
        return reject(new Error('Nodemailer gaf geen message-object terug'));
      }
      if (Buffer.isBuffer(info.message)) {
        resolve(info.message);
      } else if (typeof info.message.pipe === 'function') {
        // Stream (nodemailer without buffer:true or some versions)
        const chunks = [];
        info.message.on('data', c => chunks.push(c));
        info.message.on('end', () => resolve(Buffer.concat(chunks)));
        info.message.on('error', reject);
      } else {
        reject(new Error(`Onverwacht message-type: ${typeof info.message}`));
      }
    });
  });

  // RFC 4648 base64url: gebruik + → - en / → _ en verwijder padding
  const raw = rawBuffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  console.log(`📤 Gmail API send: subject="${subject}" to="${to}" rawSize=${rawBuffer.length}`);

  const result = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });

  console.log(`📧 Verstuurd via Gmail API: ${subject} → ${to} (gmailId: ${result?.data?.id})`);
}

export async function markAsRead(ids) {
  if (!ids || ids.length === 0) return;
  const gmail = getGmailClient();
  const results = await Promise.allSettled(ids.map(id =>
    gmail.users.messages.modify({
      userId: 'me',
      id,
      requestBody: { removeLabelIds: ['UNREAD'] }
    })
  ));
  const mislukt = results.filter(r => r.status === 'rejected');
  if (mislukt.length > 0) {
    console.error(`❌ Markeren als gelezen mislukt voor ${mislukt.length}/${ids.length} emails:`,
      mislukt.map(r => r.reason?.message).join(', '));
  }
  console.log(`✉️ ${ids.length - mislukt.length}/${ids.length} email(s) gemarkeerd als gelezen`);
}
