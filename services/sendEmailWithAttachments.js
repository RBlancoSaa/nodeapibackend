// 📁 services/sendEmailWithAttachments.js
import '../utils/fsPatch.js';
import fs from 'fs';
import { getGmailTransporter } from '../utils/gmailTransport.js';

export async function sendEmailWithAttachments({ ritnummer, attachments, verwerkingsresultaten = [] }) {
  const formattedAttachments = attachments.map(att => ({
    filename: att.filename,
    content: att.content || (att.path && fs.existsSync(att.path) ? fs.readFileSync(att.path) : Buffer.from('Bestand niet gevonden'))
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
      ? `---\n📎Bijlages die niet verwerkt konden worden:\n${nietVerwerkt.map(v => `- ${v.filename}: ${v.reden || 'onbekend'}`).join('\n')}`
      : ''
  ];

  const { transporter, from } = await getGmailTransporter();
  const to = process.env.RECIPIENT_EMAIL || from;

  await transporter.sendMail({
    from,
    to,
    subject: `easytrip file - ${ritnummer}`,
    text: tekstregels.join('\n'),
    attachments: formattedAttachments
  });
}