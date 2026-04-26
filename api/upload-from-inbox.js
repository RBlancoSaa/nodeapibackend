// 📁 /api/upload-from-inbox.js
import '../utils/fsPatch.js';
import { randomUUID } from 'crypto';
import { fetchUnreadMails, markAsRead } from '../services/gmailApiService.js';
import { supabase } from '../services/supabaseClient.js';

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

    const runId = randomUUID();
    const logEntries = [];

    function addLog(mail, type, klant, easyBestanden, status, fout_melding = null) {
      logEntries.push({
        run_id:         runId,
        email_subject:  mail.subject,
        email_van:      mail.from,
        type,
        klant:          klant || null,
        easy_bestanden: easyBestanden,
        status,
        fout_melding:   fout_melding || null
      });
    }

    console.log('📡 Gmail API: ophalen ongelezen emails...');
    const { mails, allAttachments, ids } = await fetchUnreadMails();

    if (mails.length === 0) {
      console.log('📭 Geen ongelezen mails gevonden.');
      return res.status(200).json({ success: true, run_id: runId, message: 'Geen ongelezen mails', log: [] });
    }

    console.log(`📨 ${mails.length} ongelezen email(s) gevonden`);

    for (const mail of mails) {
      const type = classifyEmail(mail);
      console.log(`📧 [${type.toUpperCase()}] ${mail.subject}`);

      // ── Updates ───────────────────────────────────────────────────────────
      if (type === 'update') {
        addLog(mail, 'update', null, [], 'overgeslagen');
        console.log(`⏭️ Update overgeslagen: ${mail.subject}`);
        continue;
      }

      // ── Reserveringen ─────────────────────────────────────────────────────
      if (type === 'reservering') {
        try {
          const bestanden = await handleReservering({
            subject:  mail.subject,
            bodyText: mail.bodyText,
            from:     mail.from,
            date:     mail.date
          });
          addLog(mail, 'reservering', 'reservering', bestanden ?? [], 'verwerkt');
        } catch (err) {
          console.error('❌ handleReservering fout:', err.message);
          addLog(mail, 'reservering', 'reservering', [], 'fout', err.message);
        }
        continue;
      }

      // ── Transportopdrachten ───────────────────────────────────────────────
      if (type === 'transport') {
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
              const bestanden = await h({ buffer: att.buffer, base64: att.base64, filename: att.filename });
              addLog(mail, 'transport', klant, bestanden ?? [], 'verwerkt');
            } catch (err) {
              console.error(`❌ Handler ${klant} fout:`, err.message);
              addLog(mail, 'transport', klant, [], 'fout', err.message);
            }
          } else {
            console.log(`⏭️ Geen handler voor: ${att.filename}`);
            addLog(mail, 'transport', null, [], 'overgeslagen');
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
            const bestanden = await handleSteinweg({
              route1Buffer: route1Att?.content  || fallbackAtt?.content || null,
              route2Buffer: route2Att?.content  || null,
              emailBody:    mail.bodyText  || '',
              emailSubject: mail.subject   || '',
              emailSource:  mail.source    || null
            });
            addLog(mail, 'transport', 'steinweg', bestanden ?? [], 'verwerkt');
          } catch (err) {
            console.error('❌ handleSteinweg fout:', err.message);
            addLog(mail, 'transport', 'steinweg', [], 'fout', err.message);
          }
        }

        continue;
      }

      // ── Onbekend / Privé ──────────────────────────────────────────────────
      addLog(mail, 'onbekend', null, [], 'overgeslagen');
      console.log(`❓ Onbekend, overgeslagen: ${mail.subject}`);
    }

    // Markeer alle emails als gelezen
    await markAsRead(ids);

    // Sla logboek op in Supabase
    if (logEntries.length > 0) {
      const { error: dbError } = await supabase
        .from('verwerkingslog')
        .insert(logEntries);
      if (dbError) {
        console.error('⚠️ Logboek opslaan mislukt:', dbError.message);
      } else {
        console.log(`📒 ${logEntries.length} logregels opgeslagen (run: ${runId})`);
      }
    }

    // Samenvatting
    const transport   = logEntries.filter(e => e.type === 'transport'   && e.status === 'verwerkt');
    const reservering = logEntries.filter(e => e.type === 'reservering' && e.status === 'verwerkt');
    const updates     = logEntries.filter(e => e.type === 'update');
    const onbekend    = logEntries.filter(e => e.type === 'onbekend');
    const fouten      = logEntries.filter(e => e.status === 'fout');

    return res.status(200).json({
      success:   true,
      run_id:    runId,
      mailCount: mails.length,
      verwerkt: {
        transport:   transport.length,
        reservering: reservering.length,
        updates:     updates.length,
        onbekend:    onbekend.length,
        fouten:      fouten.length
      },
      easy_bestanden: transport.flatMap(e => e.easy_bestanden),
      fouten_detail:  fouten.map(e => ({ subject: e.email_subject, klant: e.klant, fout: e.fout_melding })),
      log:            logEntries
    });

  } catch (error) {
    console.error('💥 Fout:', error);
    return res.status(500).json({ success: false, error: error.message || 'Onbekende serverfout' });
  }
}
