import fs from 'fs';
import path from 'path';

export async function downloadPdfAttachments(client, mails) {
  const downloadFolder = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(downloadFolder)) {
    fs.mkdirSync(downloadFolder);
  }

  for (const mail of mails) {
    for (const part of mail.pdfParts) {
      const attachment = await client.download(mail.uid, part);
      const filename = `pdf-${mail.uid}-${part}.pdf`;
      const filepath = path.join(downloadFolder, filename);
      await fs.promises.writeFile(filepath, attachment);
      console.log(`PDF opgeslagen: ${filename}`);
    }
  }
}