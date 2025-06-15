import express from 'express';
import dotenv from 'dotenv';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs/promises';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

async function fetchUnreadMails() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT),
    secure: process.env.IMAP_SECURE === 'true',
    auth: {
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASS,
    },
  });

  await client.connect();
  await client.mailboxOpen('INBOX');
  const uids = await client.search({ seen: false });

  if (uids.length === 0) {
    await client.logout();
    return { client, mails: [] };
  }

  const mails = [];
  for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true })) {
    const pdfParts = [];
    function findPDFs(structure) {
      if (
        structure.disposition?.type?.toUpperCase() === 'ATTACHMENT' &&
        structure.type === 'application' &&
        structure.subtype.toLowerCase() === 'pdf'
      ) {
        pdfParts.push(structure.part);
      }
      if (structure.childNodes) structure.childNodes.forEach(findPDFs);
      if (structure.parts) structure.parts.forEach(findPDFs);
    }
    if (message.bodyStructure) findPDFs(message.bodyStructure);

    mails.push({
      uid: message.uid,
      subject: message.envelope.subject || '(geen onderwerp)',
      from: message.envelope.from.map(f => `${f.name ?? ''} <${f.address}>`.trim()).join(', '),
      date: message.envelope.date,
      pdfParts,
    });
  }

  return { client, mails };
}

async function downloadPdfAttachments(client, mails) {
  const tmpFolder = path.join(process.cwd(), 'tmp');
  await fs.mkdir(tmpFolder, { recursive: true });
  const attachments = [];

  for (const mail of mails) {
    for (const part of mail.pdfParts) {
      const attachment = await client.download(mail.uid, part);
      const filename = `pdf-${mail.uid}-${part}.pdf`;
      const filepath = path.join(tmpFolder, filename);
      await fs.writeFile(filepath, attachment);
      attachments.push({ path: filepath, filename });
    }
  }

  return attachments;
}

async function sendEasyFile(toEmail, subject, attachments) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_PORT == 465, 
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.FROM_EMAIL,
    to: toEmail,
    subject,
    text: 'Hierbij de gegenereerde .easy bestanden als bijlage.',
    attachments,
  };

  return await transporter.sendMail(mailOptions);
}

app.get('/check-inbox', async (req, res) => {
  try {
    const { client, mails } = await fetchUnreadMails();
    if (mails.length === 0) {
      await client.logout();
      return res.json({ success: true, message: 'Geen ongelezen mails.' });
    }

    // Download PDF-bijlagen
    const attachments = await downloadPdfAttachments(client, mails);

    // Dummy .easy bestand per mail (nu 1 dummy file, hier implementatie later)
    const easyPath = path.join(process.cwd(), 'tmp', 'voorbeeld.easy');
    await fs.writeFile(easyPath, 'Dit is een dummy .easy bestand');
    attachments.push({ path: easyPath, filename: 'voorbeeld.easy' });

    // Stuur mail met .easy bestand naar jezelf
    await sendEasyFile(process.env.IMAP_USER, 'Automatisch gegenereerde .easy bestanden', attachments);

    await client.logout();

    // BigInt naar string converteren om JSON stringify error te voorkomen
    const mailsStringified = JSON.parse(JSON.stringify(mails, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));

    res.json({ success: true, mails: mailsStringified, message: 'PDF\'s gedownload en mail verstuurd.' });
  } catch (error) {
    console.error('Fout:', error);
    res.status(500).json({ success: false, error: error.message || 'Onbekende fout' });
  }
});

app.listen(PORT, () => {
  console.log(`Server draait op poort ${PORT}`);
});