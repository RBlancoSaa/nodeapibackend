// 📁 /api/upload-from-inbox.js
import '../utils/fsPatch.js';
import { fetchUnreadMails, markAsRead } from '../services/gmailApiService.js';

import handleJordex from '../handlers/handleJordex.js';
import handleDFDS from '../handlers/handleDFDS.js';
import handleB2L from '../handlers/handleB2L.js';
import handleEasyfresh from '../handlers/handleEasyfresh.js';
import handleKWE from '../handlers/handleKWE.js';
import handleNeelevat from '../handlers/handleNeelevat.js';
import handleRitra from '../handlers/handleRitra.js';
import handleSteinweg from '../handlers/handleSteinweg.js';
import handleReservering from '../handlers/handleReservering.js';

const handlers = {
  jordex:    { match: name => name.includes('jordex'),                                        handler: handleJordex },
  dfds:      { match: name => name.includes('dfds') && name.includes('transportorder'),       handler: handleDFDS },
  b2l:       { match: name => name.includes('b2l'),                                           handler: handleB2L },
  easyfresh: { match: name => name.includes('easyfresh'),                                     handler: handleEasyfresh },
  kwe:       { match: name => name.includes('kwe'),                                           handler: handleKWE },
  neelevat:  { match: name => name.includes('neelevat'),                                      handler: handleNeelevat },
  ritra:     { match: name => name.includes('ritra') || name.includes('transport_'),          handler: handleRitra }
};

function classifyEmail(mail) {
  const subject = (mail.subject || '').toLowerCase();
  const body    = (mail.bodyText || '').toLowerCase();

  if (/\b(update|wijziging|aanpassing|gewijzigd|correction|corrected|amendment)\b/.test(subject)) {
    return 'update';
  }

  if (/reservering|ter\s+reservering/.test(subject) || /ter\s+reservering/.test(body)) {
    return 'reservering';
  }

  const attachments = mail.attachments || [];
  const heeftTransport = attachments.some(a => {
    const fn = (a.filename || '').toLowerCase();
    return Object.values(handlers).some(h => h.match(fn));
  });
  const heeftSteinweg =
    attachments.some(a => /pickupnotice/i.test(a.filename || '')) ||
    attachments.some(a => /steinweg/i.test(a.filename || '')) ||
    /steinweg/i.test(subject);

  if (heeftTransport || heeftSteinweg) return 'transport';

  return 'onbekend';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const missing = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'].filter(k => !process.env[k]);
    if (missing.length > 0) {
      return res.status(500).json({ error: `Ontbrekende omgevingsvariabelen: ${missing.join(', ')}` });
    }

    console.log('📡 Gmail API: ophalen ongelezen emails...');
    const { mails, allAttachments, ids } = await fetchUnreadMails();

    if (mails.length === 0) {
      console.log('📭 Geen ongelezen mails gevonden.');
      return res.status(200).json({ message: 'Geen ongelezen mails' });
    }

    console.log(`📨 ${mails.length} ongelezen email(s) gevonden`);

    const verwerkt = { transport: 0, reservering: 0, update: 0, onbekend: 0 };

    for (const mail of mails) {
      const type = classifyEmail(mail);
      console.log(`📧 [${type.toUpperCase()}] ${mail.subject}`);

      if (type === 'update') {
        verwerkt.update++;
        console.log(`⏭️ Update-email overgeslagen: ${mail.subject}`);
        continue;
      }

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

      if (type === 'transport') {
        verwerkt.transport++;

        const mailAtts = allAttachments.filter(a => a.gmailId === mail.gmailId);

        // PDF-bijlagen
        const pdfAtts = mailAtts.filter(a => a.filename?.toLowerCase().endsWith('.pdf'));
        for (const att of pdfAtts) {
          const fn = (att.filename || '').toLowerCase();
          const matchedHandler = Object.entries(handlers).find(([, cfg]) => cfg.match(fn));
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

        // Steinweg XLSX
        const xlsxAtts = mailAtts.filter(a => a.filename?.toLowerCase().endsWith('.xlsx'));
        const isSteinweg =
          xlsxAtts.some(a => /pickupnotice/i.test(a.filename)) ||
          xlsxAtts.some(a => /steinweg/i.test(a.filename)) ||
          /steinweg/i.test(mail.subject || '');

        if (isSteinweg && xlsxAtts.length > 0) {
          console.log(`📊 Steinweg email: ${mail.subject} (${xlsxAtts.length} xlsx)`);
          const route1Att   = xlsxAtts.find(a => /route.?1/i.test(a.filename));
          const route2Att   = xlsxAtts.find(a => /route.?2/i.test(a.filename));
          const fallbackAtt = !route1Att && !route2Att ? xlsxAtts[0] : null;
          try {
            await handleSteinweg({
              route1Buffer:  route1Att?.content  || fallbackAtt?.content || null,
              route2Buffer:  route2Att?.content  || null,
              emailBody:     mail.bodyText  || '',
              emailSubject:  mail.subject   || '',
              emailSource:   mail.source    || null
            });
          } catch (err) {
            console.error('❌ handleSteinweg fout:', err.message);
          }
        }

        continue;
      }

      verwerkt.onbekend++;
      console.log(`❓ Onbekend, overgeslagen: ${mail.subject}`);
    }

    await markAsRead(ids);

    return res.status(200).json({
      success: true,
      mailCount: mails.length,
      verwerkt
    });

  } catch (error) {
    console.error('💥 Fout:', error);
    return res.status(500).json({ success: false, error: error.message || 'Onbekende serverfout' });
  }
}
