// 📁 services/sendEmailWithAttachments.js

import fs from 'fs';
import transporter from '../utils/smtpTransport.js';

export async function sendEmailWithAttachments({ reference, filePath, filename }) {
  const mailOptions = {
    from: process.env.FROM_EMAIL,
    to: process.env.FROM_EMAIL,
    subject: `easytrip file - automatisch gegenereerd - ${reference}`,
    text: `In de bijlage vind je het gegenereerde Easytrip-bestand voor referentie: ${reference}`,
    attachments: [
      {
        filename,
        content: fs.readFileSync(filePath)
      }
    ]
  };

  await transporter.sendMail(mailOptions);
}