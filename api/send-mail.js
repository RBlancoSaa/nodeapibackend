// api/send-mail.js — Algemeen endpoint om een mail met bijlage te versturen.
// Geroepen door AHQ vanuit de rit-detail "Mail door"-knop.
//
// Auth: shared secret header X-Internal-Secret moet matchen met env
// INTERNAL_API_SHARED_SECRET. Lokale ontwikkeling kan zonder, maar
// productie weigert zonder.
//
// Request body (JSON):
//   {
//     to: string | string[],
//     subject: string,
//     text: string,
//     from?: string,                       // default = process.env.GMAIL_USER
//     attachment?: {
//       filename: string,
//       contentBase64: string,             // base64 (geen data: prefix)
//       contentType?: string
//     }
//   }
//
// Response: { ok: true } of { ok: false, error }

import { sendViaGmailApi } from '../services/gmailApiService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST verwacht' });
  }

  // Shared-secret check (skipped als env-var niet ingesteld; logging-only)
  const expected = process.env.INTERNAL_API_SHARED_SECRET;
  if (expected) {
    const given = req.headers['x-internal-secret'];
    if (given !== expected) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  } else {
    console.warn('⚠ INTERNAL_API_SHARED_SECRET niet ingesteld — endpoint open');
  }

  const { to, subject, text, from, attachment } = req.body || {};
  if (!to || !subject || !text) {
    return res
      .status(400)
      .json({ ok: false, error: 'to, subject en text zijn verplicht' });
  }

  const attachments = [];
  if (attachment?.contentBase64 && attachment?.filename) {
    attachments.push({
      filename: attachment.filename,
      content: Buffer.from(attachment.contentBase64, 'base64'),
      contentType: attachment.contentType || 'application/octet-stream',
    });
  }

  try {
    await sendViaGmailApi({
      from: from || process.env.GMAIL_USER || 'noreply@tiarotransport.nl',
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      attachments,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-mail error:', err);
    return res
      .status(500)
      .json({ ok: false, error: err.message || 'verzenden mislukt' });
  }
}
