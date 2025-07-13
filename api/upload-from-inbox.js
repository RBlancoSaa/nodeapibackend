// 📁 /api/upload-from-inbox.js
import '../utils/fsPatch.js';
import { ImapFlow } from 'imapflow';
import { parseAttachmentsFromEmails } from '../services/parseAttachments.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

// ✅ Parsers (handlers) importeren
import handleJordex from '../handlers/handleJordex.js';
import handleDFDS from '../handlers/handleDFDS.js';
import { handleB2L } from '../handlers/handleB2L.js';
import handleEasyfresh from '../handlers/handleEasyfresh.js';
import handleKWE from '../handlers/handleKWE.js';
import handleNeelevat from '../handlers/handleNeelevat.js';
import handleRitra from '../handlers/handleRitra.js';

// ✅ Klantdetectie en handlermapping
const handlers = {
  jordex: { match: name => name.includes('jordex'), handler: handleJordex },
  dfds: { match: name => name.includes('dfds') && name.includes('transportorder'), handler: handleDFDS },
  b2l: { match: name => name.includes('b2l'), handler: handleB2L },
  easyfresh: { match: name => name.includes('easyfresh'), handler: handleEasyfresh },
  kwe: { match: name => name.includes('kwe'), handler: handleKWE },
  neelevat: { match: name => name.includes('neelevat'), handler: handleNeelevat },
  ritra: { match: name => name.includes('ritra'), handler: handleRitra }
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let client;
  try {
    console.log('📡 Verbind met IMAP...');
    client = new ImapFlow({
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT),
      secure: process.env.IMAP_SECURE === 'true',
      auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS
      }
    });

    await client.connect();
    await client.mailboxOpen('INBOX');

    const uids = await client.search({ seen: false });
    if (uids.length === 0) {
      await client.logout();
      console.log('📭 Geen ongelezen mails gevonden.');
      return res.status(200).json({ message: 'Geen ongelezen mails' });
    }

    console.log(`📨 Ongelezen e-mails gevonden: ${uids.length}`);
    const { mails, allAttachments } = await parseAttachmentsFromEmails(client, uids);

    const pdfAttachments = allAttachments.filter(att =>
      att.filename && att.filename.toLowerCase().endsWith('.pdf')
    );

    console.log(`📎 PDF-bijlagen gedetecteerd: ${pdfAttachments.length}`);
    pdfAttachments.forEach(att => {
      console.log(` - ${att.filename} (${att.base64 ? 'base64 ✅' : 'base64 ❌'})`);
    });

    const uploadedFiles = await uploadPdfAttachmentsToSupabase(pdfAttachments);
    console.log(`☁️ Upload naar Supabase voltooid: ${uploadedFiles.length} bestanden`);

    for (const attachment of pdfAttachments) {
      const filename = attachment.filename?.toLowerCase() || '';

      const matchedHandler = Object.entries(handlers).find(([key, config]) =>
        config.match(filename)
      );

      if (matchedHandler) {
        const [klant, { handler }] = matchedHandler;
        console.log(`🚚 Handler gevonden voor ${klant.toUpperCase()}: ${handler.name}`);
        try {
          await handler({
            buffer: attachment.buffer,
            base64: attachment.base64,
            filename: attachment.filename
          });
        } catch (err) {
          console.error(`❌ Fout tijdens verwerking ${klant}:`, err.message);
        }
      } else {
        console.log(`⏭️ Geen handler gevonden voor: ${filename}`);
      }
    }

    await client.logout();
    return res.status(200).json({
      success: true,
      mailCount: mails.length,
      attachmentCount: allAttachments.length,
      uploadedCount: uploadedFiles.length,
      filenames: uploadedFiles.map(f => f.filename)
    });

  } catch (error) {
    if (client) await client.logout().catch(() => {});
    console.error('💥 Upload-fout:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Onbekende serverfout tijdens upload'
    });
  }
}