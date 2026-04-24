// 📁 /api/upload-from-inbox.js
import '../utils/fsPatch.js';
import { ImapFlow } from 'imapflow';
import { parseAttachmentsFromEmails } from '../services/parseAttachments.js';
import { uploadPdfAttachmentsToSupabase } from '../services/uploadPdfAttachmentsToSupabase.js';
import { sendEmailWithAttachments } from '../services/sendEmailWithAttachments.js';

// ✅ Parsers (handlers) importeren
import handleJordex from '../handlers/handleJordex.js';
import handleDFDS from '../handlers/handleDFDS.js';
import handleB2L from '../handlers/handleB2L.js';
import handleEasyfresh from '../handlers/handleEasyfresh.js';
import handleKWE from '../handlers/handleKWE.js';
import handleNeelevat from '../handlers/handleNeelevat.js';
import handleRitra from '../handlers/handleRitra.js';
import handleSteinweg from '../handlers/handleSteinweg.js';
import handleReservering from '../handlers/handleReservering.js';

// ✅ Klantdetectie en handlermapping (op bestandsnaam)
const handlers = {
  jordex:    { match: name => name.includes('jordex'),                                         handler: handleJordex },
  dfds:      { match: name => name.includes('dfds') && name.includes('transportorder'),        handler: handleDFDS },
  b2l:       { match: name => name.includes('b2l'),                                            handler: handleB2L },
  easyfresh: { match: name => name.includes('easyfresh'),                                      handler: handleEasyfresh },
  kwe:       { match: name => name.includes('kwe'),                                            handler: handleKWE },
  neelevat:  { match: name => name.includes('neelevat'),                                       handler: handleNeelevat },
  ritra:     { match: name => name.includes('ritra') || name.includes('transport_'),           handler: handleRitra }
};

// ✅ Email classificatie
function classifyEmail(mail) {
  const subject = (mail.subject || '').toLowerCase();
  const body    = (mail.bodyText || '').toLowerCase();

  // Update / wijziging → overslaan
  if (/\b(update|wijziging|aanpassing|gewijzigd|correction|corrected|amendment)\b/.test(subject)) {
    return 'update';
  }

  // Reservering
  if (/reservering|ter\s+reservering/.test(subject) || /ter\s+reservering/.test(body)) {
    return 'reservering';
  }

  // Heeft er een bekende transport-bijlage?
  const attachments = mail.attachments || [];
  const heeftTransport =
    attachments.some(a => {
      const fn = (a.filename || '').toLowerCase();
      return Object.values(handlers).some(h => h.match(fn));
    }) ||
    attachments.some(a => {
      const fn = (a.filename || '').toLowerCase();
      return fn.endsWith('.pdf') || fn.endsWith('.xlsx');
    });

  if (heeftTransport) return 'transport';

  // Heeft "reservering" ook in de bodytekst?
  if (/reservering/.test(body)) return 'reservering';

  return 'onbekend';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let client;
  try {
    // Fail fast if critical env vars are missing
    const missing = ['IMAP_HOST','IMAP_USER','IMAP_PASS'].filter(k => !process.env[k]);
    if (missing.length > 0) {
      return res.status(500).json({ error: `Ontbrekende omgevingsvariabelen: ${missing.join(', ')}` });
    }

    console.log('📡 Verbind met IMAP...');
    client = new ImapFlow({
      host: process.env.IMAP_HOST,
      port: Number(process.env.IMAP_PORT || 993),
      secure: process.env.IMAP_SECURE !== 'false',
      auth: {
        user: process.env.IMAP_USER,
        pass: process.env.IMAP_PASS
      },
      connectionTimeout: 8000,
      greetingTimeout:   5000,
      socketTimeout:     8000,
      logger: false
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

    const verwerkt    = { transport: 0, reservering: 0, update: 0, onbekend: 0 };
    const uploadedFiles = [];
    let verwerkingsresultaten = [];

    for (const mail of mails) {
      const type = classifyEmail(mail);
      console.log(`📧 [${type.toUpperCase()}] ${mail.subject}`);

      // ── Updates overslaan ─────────────────────────────────────────
      if (type === 'update') {
        console.log(`⏭️ Update-email overgeslagen: ${mail.subject}`);
        verwerkt.update++;
        continue;
      }

      // ── Reserveringen ─────────────────────────────────────────────
      if (type === 'reservering') {
        try {
          await handleReservering({
            subject:  mail.subject,
            bodyText: mail.bodyText,
            from:     mail.from,
            date:     mail.date
          });
          verwerkt.reservering++;
        } catch (err) {
          console.error('❌ handleReservering fout:', err.message);
        }
        continue;
      }

      // ── Transportopdrachten ───────────────────────────────────────
      if (type === 'transport') {
        verwerkt.transport++;

        // PDF-bijlagen verwerken
        const pdfAtts = (mail.attachments || []).filter(a =>
          a.filename?.toLowerCase().endsWith('.pdf')
        );

        if (pdfAtts.length > 0) {
          // Upload naar Supabase
          const mailAllAtts = allAttachments.filter(a => a.uid === mail.uid);
          const { uploadedFiles: uf, verwerkingsresultaten: vr } =
            await uploadPdfAttachmentsToSupabase(mailAllAtts.filter(a => a.filename?.toLowerCase().endsWith('.pdf')));
          uploadedFiles.push(...uf);
          verwerkingsresultaten.push(...(vr || []));

          for (const att of mailAllAtts.filter(a => a.filename?.toLowerCase().endsWith('.pdf'))) {
            const filename = (att.filename || '').toLowerCase();
            const matchedHandler = Object.entries(handlers).find(([, cfg]) => cfg.match(filename));
            if (matchedHandler) {
              const [klant, { handler: h }] = matchedHandler;
              console.log(`🚚 Handler: ${klant.toUpperCase()} voor ${att.filename}`);
              try {
                await h({ buffer: att.buffer, base64: att.base64, filename: att.filename });
              } catch (err) {
                console.error(`❌ Handler ${klant} fout:`, err.message);
              }
            } else {
              console.log(`⏭️ Geen handler voor: ${att.filename}`);
            }
          }
        }

        // Steinweg xlsx-bijlagen verwerken
        const xlsxAtts = (mail.attachments || []).filter(a =>
          a.filename?.toLowerCase().endsWith('.xlsx')
        );
        const isSteinweg =
          xlsxAtts.some(a => /pickupnotice/i.test(a.filename)) ||
          xlsxAtts.some(a => /steinweg/i.test(a.filename)) ||
          /steinweg/i.test(mail.subject || '');

        if (isSteinweg && xlsxAtts.length > 0) {
          console.log(`📊 Steinweg email: ${mail.subject} (${xlsxAtts.length} xlsx)`);
          const route1Att  = xlsxAtts.find(a => /route.?1/i.test(a.filename));
          const route2Att  = xlsxAtts.find(a => /route.?2/i.test(a.filename));
          const fallbackAtt = !route1Att && !route2Att ? xlsxAtts[0] : null;
          try {
            await handleSteinweg({
              route1Buffer:  route1Att?.content  || fallbackAtt?.content || null,
              route2Buffer:  route2Att?.content  || null,
              emailBody:     mail.bodyText  || '',
              emailSubject:  mail.subject   || '',
              emailSource:   mail.source    || null,
              emailFilename: `${(mail.subject || 'steinweg').replace(/[^\w\d\-]/g, '_')}_${mail.uid}.eml`
            });
          } catch (err) {
            console.error('❌ handleSteinweg fout:', err.message);
          }
        }

        continue;
      }

      // ── Onbekend ──────────────────────────────────────────────────
      verwerkt.onbekend++;
      console.log(`❓ Onbekende email-type, overgeslagen: ${mail.subject}`);
    }

    // Verstuur upload-samenvatting als er bestanden geüpload zijn
    if (uploadedFiles.length > 0) {
      await sendEmailWithAttachments({
        ritnummer: verwerkingsresultaten.find(v => v.parsed)?.ritnummer || 'onbekend',
        attachments: uploadedFiles.map(file => ({
          filename: file.filename,
          content: file.content
        })),
        verwerkingsresultaten
      });
    }

    // Markeer alle verwerkte emails als gelezen
    if (uids.length > 0) {
      await client.messageFlagsAdd(uids, ['\\Seen']);
      console.log(`✉️ ${uids.length} email(s) gemarkeerd als gelezen`);
    }

    await client.logout();
    return res.status(200).json({
      success: true,
      mailCount: mails.length,
      verwerkt,
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
