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
    return;
  }

  for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true })) {
    const subject = message.envelope?.subject || '(geen onderwerp)';
    console.log('Mail gevonden:', subject);

    if (!message.bodyStructure) continue;

    const pdfParts = [];

    function findPDFs(structure) {
      if (
        structure.disposition &&
        structure.disposition.type &&
        structure.disposition.type.toUpperCase() === 'ATTACHMENT' &&
        structure.type === 'application' &&
        structure.subtype.toLowerCase() === 'pdf'
      ) {
        pdfParts.push(structure.part);
      }
      if (structure.childNodes) {
        structure.childNodes.forEach(findPDFs);
      }
      if (structure.parts) {
        structure.parts.forEach(findPDFs);
      }
    }

    findPDFs(message.bodyStructure);

    for (const part of pdfParts) {
      const attachment = await client.download(message.uid, part);
      console.log(`PDF-bijlage gevonden: part ${part}, grootte: ${attachment.length} bytes`);
      // Hier kun je de attachment verder verwerken of opslaan
    }
  }

  await client.logout();
  console.log('IMAP-verbinding gesloten, klaar met checkInbox');
}