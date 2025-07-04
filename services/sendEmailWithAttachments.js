// 📁 services/sendEmailWithAttachments.js
import '../utils/fsPatch.js';
import fs from 'fs';
import transporter from '../utils/smtpTransport.js';

export async function sendEmailWithAttachments({ reference, attachments }) {
  const formattedAttachments = attachments.map(att => ({
    filename: att.filename,
    content: fs.readFileSync(att.path)
  }));

  const mailOptions = {
    from: process.env.FROM_EMAIL,
    to: process.env.FROM_EMAIL,
    subject: `easytrip file - automatisch gegenereerd - ${reference}`,
    text: `In de bijlage vind je het gegenereerde Easytrip-bestand + de originele opdracht PDF voor referentie: ${reference}`,
    attachments: formattedAttachments
  };

  await transporter.sendMail(mailOptions);
  await sendEmailWithAttachments({
  reference: data.reference,
  attachments: [
    { filename: bestandsnaam, path: localPath },
    { filename: originelePdfNaam, path: padOriginelePdf }
  ]
});
}