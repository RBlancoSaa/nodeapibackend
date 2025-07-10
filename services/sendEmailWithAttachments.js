// 📁 services/sendEmailWithAttachments.js
import '../utils/fsPatch.js';
import fs from 'fs';
import transporter from '../utils/smtpTransport.js';

export async function sendEmailWithAttachments({ ritnr, attachments }) {
  const formattedAttachments = attachments.map(att => ({
  filename: att.filename,
  content: att.content || (att.path ? fs.readFileSync(att.path) : Buffer.from('')) // fallback leeg bestand
}));

  const mailOptions = {
    from: process.env.FROM_EMAIL,
    to: process.env.FROM_EMAIL,
    subject: `easytrip file - ${ritnummer}`,
    text: `In de bijlage vind je het gegenereerde Easytrip-bestand en
    de originele opdracht PDF voor referentie: ${ritnummer}`,
    attachments: formattedAttachments
  };

  await transporter.sendMail(mailOptions);
}