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

// Elke klant heeft: matchFile, optioneel matchSender + matchSubject, en handler
const handlers = {
  jordex: {
    matchFile:    fn  => fn.includes('jordex'),
    matchSender:  frm => /@jordex\.com/i.test(frm),
    matchSubject: sub => /\bOE\d{5,}\b/i.test(sub),   // bijv. "OE2609386"
    handler: handleJordex
  },
  dfds: {
    matchFile:    fn  => fn.includes('dfds') && fn.includes('transportorder'),
    matchSender:  frm => /@dfds\.com/i.test(frm),
    handler: handleDFDS
  },
  b2l: {
    matchFile:    fn  => fn.includes('b2l'),
    matchSender:  frm => /@b2l\.nl/i.test(frm) || /@b2lcargocare\.com/i.test(frm) || /@b2l-cargocare\.com/i.test(frm),
    handler: handleB2L
  },
  easyfresh: {
    matchFile:    fn  => fn.includes('easyfresh'),
    matchSender:  frm => /@easyfresh\.com/i.test(frm),
    handler: handleEasyfresh
  },
  kwe: {
    matchFile:    fn  => fn.includes('kwe'),
    matchSender:  frm => /@kwe\.com/i.test(frm),
    handler: handleKWE
  },
  neelevat: {
    matchFile:    fn  => fn.includes('neelevat') || fn.includes('neele-vat'),
    matchSender:  frm => /@neele-vat\.com/i.test(frm) || /@neelevat\.com/i.test(frm),
    handler: handleNeelevat
  },
  ritra: {
    matchFile:    fn  => fn.includes('ritra'),
    matchSender:  frm => /@ritra\.nl/i.test(frm),
    handler: handleRitra
  },
  steinweg: {
    matchFile:    fn  => /steinweg/i.test(fn) || /pickupnotice/i.test(fn),
    matchSender:  frm => /@steinweg\.com/i.test(frm) || /@nl\.steinweg\.com/i.test(frm),
    matchSubject: sub => /steinweg/i.test(sub),
    handler: handleSteinweg
  }
};

/**
 * Zoek de juiste handler op basis van bestandsnaam, afzender en onderwerp.
 * Volgorde: bestandsnaam → afzender → onderwerp
 */
function findHandler(filename, mailFrom, mailSubject) {
  const fn  = (filename    || '').toLowerCase();
  const frm = (mailFrom    || '').toLowerCase();
  const sub = (mailSubject || '');

  for (const [klant, cfg] of Object.entries(handlers)) {
    if (cfg.matchFile   && cfg.matchFile(fn))   return [klant, cfg];
    if (cfg.matchSender && cfg.matchSender(frm)) return [klant, cfg];
    if (cfg.matchSubject && cfg.matchSubject(sub)) return [klant, cfg];
  }
  return null;
}

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

  // Controleer PDF-bijlagen op bekende handlers (inclusief afzender + onderwerp)
  const heeftTransport = attachments.some(a => {
    const fn = (a.filename || '').toLowerCase();
    if (Object.values(handlers).some(h => h.matchFile && h.matchFile(fn))) return true;
    return false;
  });

  // Controleer ook op afzender/onderwerp niveau (Jordex-situatie: PDF heeft geen klant in naam)
  const heeftTransportViaSenderSubject = !!findHandlerForMail(mail);

  const heeftSteinweg =
    attachments.some(a => /pickupnotice/i.test(a.filename || '')) ||
    attachments.some(a => /steinweg/i.test(a.filename || '')) ||
    /steinweg/i.test(subject);

  if (heeftTransport || heeftTransportViaSenderSubject || heeftSteinweg) return 'transport';
  return 'onbekend';
}

/** Zoek handler op basis van alleen afzender/onderwerp (geen bijlage nodig) */
function findHandlerForMail(mail) {
  const frm = (mail.from    || '').toLowerCase();
  const sub = (mail.subject || '');
  for (const [klant, cfg] of Object.entries(handlers)) {
    if (cfg.matchSender  && cfg.matchSender(frm))  return [klant, cfg];
    if (cfg.matchSubject && cfg.matchSubject(sub))  return [klant, cfg];
  }
  return null;
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

        let verwerkteContainers = 0;

        for (const att of pdfAtts) {
          const match = findHandler(att.filename, mail.from, mail.subject);
          if (match) {
            const [klant, { handler: h }] = match;
            console.log(`🚚 Handler: ${klant.toUpperCase()} voor ${att.filename}`);
            try {
              const bestanden = await h({
                buffer:      att.buffer,
                base64:      att.base64,
                filename:    att.filename,
                mailSubject: mail.subject,
                mailFrom:    mail.from
              });
              addLog(mail, 'transport', klant, bestanden ?? [], 'verwerkt');
              verwerkteContainers++;
            } catch (err) {
              console.error(`❌ Handler ${klant} fout:`, err.message);
              addLog(mail, 'transport', klant, [], 'fout', err.message);
            }
          } else {
            console.log(`⏭️ Geen handler voor: ${att.filename}`);
            addLog(mail, 'transport', null, [], 'overgeslagen');
          }
        }

        // Geen PDF-bijlagen maar toch transport (bijv. Jordex met generieke bestandsnaam)?
        // Probeer de mail zelf te matchen op afzender/onderwerp
        if (pdfAtts.length === 0) {
          const match = findHandlerForMail(mail);
          if (match) {
            const [klant, { handler: h }] = match;
            console.log(`🚚 Handler via afzender/onderwerp: ${klant.toUpperCase()} (geen PDF-bijlage)`);
            addLog(mail, 'transport', klant, [], 'overgeslagen', 'Geen PDF-bijlage gevonden');
          } else {
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
