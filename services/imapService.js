import { ImapFlow } from 'imapflow';
import dotenv from 'dotenv';

dotenv.config();

export async function checkInbox() {
  console.log('Start IMAP connectie...');
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
  console.log('Verbonden met IMAP-server.');

  await client.mailboxOpen('INBOX');
  console.log('Mailbox INBOX geopend.');

  const uids = await client.search({ seen: false });
  console.log(`Aantal ongelezen e-mails: ${uids.length}`);

  if (uids.length === 0) {
    console.log('Geen ongelezen mails gevonden.');
    await client.logout();
    console.log('IMAP-verbinding gesloten.');
    return [];
  }

  const mails = [];
  for await (const message of client.fetch(uids, { envelope: true })) {
    mails.push({
      subject: message.envelope.subject || '(geen onderwerp)',
      from: message.envelope.from.map(f => `${f.name} <${f.address}>`).join(', '),
      date: message.envelope.date,
    });
    console.log(`Mail gevonden: "${mails[mails.length - 1].subject}" van ${mails[mails.length - 1].from}`);
  }

  await client.logout();
  console.log('IMAP-verbinding netjes gesloten.');

  return mails;
}