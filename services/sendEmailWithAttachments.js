// 📁 services/sendEmailWithAttachments.js
import '../utils/fsPatch.js';
import fs from 'fs';
import transporter from '../utils/smtpTransport.js';

export async function sendEmailWithAttachments({ ritnummer, attachments, verwerkingsresultaten = [] }) {
  const formattedAttachments = attachments.map(att => ({
    filename: att.filename,
    content: att.content || (att.path ? fs.readFileSync(att.path) : Buffer.from(''))
  }));

  const verwerkte = verwerkingsresultaten.filter(v => v.parsed);
  const nietVerwerkt = verwerkingsresultaten.filter(v => !v.parsed);

  const tekstregels = [
    `Transportopdracht verwerkt: ${ritnummer}`,
    '',
    verwerkte.length
      ? `✅ Verwerkte bijlages:\n${verwerkte.map(v => `- ${v.filename}`).join('\n')}`
      : '⚠️ Geen bijlages konden verwerkt worden als transportopdracht.',
    '',
    nietVerwerkt.length
      ? `📎 Bijlages die niet verwerkt konden worden:\n${nietVerwerkt.map(v => `- ${v.filename}: ${v.reden || 'onbekend'}`).join('\n')}`
      : ''
  ];

  const mailOptions = {
    from: process.env.FROM_EMAIL,
    to: process.env.FROM_EMAIL,
    subject: `easytrip file - ${ritnummer}`,
    text: tekstregels.join('\n'),
    attachments: formattedAttachments
  };

  await transporter.sendMail(mailOptions);
}