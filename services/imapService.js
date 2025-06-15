import { ImapFlow } from 'imapflow';

export async function checkInbox() {
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
  console.log('Verbonden met IMAP-server');

  await client.mailboxOpen('INBOX');

  const uids = await client.search({ seen: false });

  if (uids.length === 0) {
    console.log('Geen ongelezen mails gevonden.');
    await client.logout();
    return [];
  }

  const mails = [];

  for await (const message of client.fetch(uids, { envelope: true })) {
    mails.push({
      subject: message.envelope.subject || '(geen onderwerp)',
      from: message.envelope.from.map(f => `${f.name || ''} <${f.address}>`.trim()).join(', '),
      date: message.envelope.date,
    });
  }

  await client.logout();
  console.log('IMAP-verbinding gesloten');
  return mails;
}
