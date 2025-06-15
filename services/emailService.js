import nodemailer from 'nodemailer';
import path from 'path';

export async function sendEasyFile(toEmail, subject, easyFilePath) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false, // gebruik true als poort 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.FROM_EMAIL,
    to: toEmail,
    subject,
    text: 'Hierbij de .easy file als bijlage.',
    attachments: [
      {
        filename: path.basename(easyFilePath),
        path: easyFilePath,
      },
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('Easy file verstuurd:', info.messageId);
}