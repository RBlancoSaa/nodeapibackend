import fs from 'fs/promises';
import path from 'path';

export async function downloadPdfAttachments(client, mails) {
  const downloadFolder = path.join(process.cwd(), 'downloads');
  try {
    await fs.mkdir(downloadFolder, { recursive: true });
  } catch (err) {
    console.error('Maken van download folder mislukt:', err);
    throw err;
  }

  for (const mail of mails) {
    for (const part of mail.pdfParts) {
      const attachment = await client.download(mail.uid, part);
      const filename = `pdf-${mail.uid}-${part}.pdf`;
      const filepath = path.join(downloadFolder, filename);
      await fs.writeFile(filepath, attachment);
      console.log(`PDF opgeslagen: ${filename}`);
    }
  }
}
