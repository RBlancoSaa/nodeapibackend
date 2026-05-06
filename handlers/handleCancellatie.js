// handlers/handleCancellatie.js
// Verwerkt annuleringen en datum-wijzigingen van klanten.
// Stuurt een notificatie-email naar de dispatcher en logt naar Supabase.
import '../utils/fsPatch.js';
import { getGmailTransporter, RECIPIENT_EMAIL } from '../utils/gmailTransport.js';

/**
 * @param {object} opts
 * @param {string} opts.subject       - Email onderwerp
 * @param {string} opts.bodyText      - Email body
 * @param {string} opts.fromEmail     - Afzender
 * @param {'cancellatie'|'wijziging'} opts.type - Type melding
 */
export default async function handleCancellatie({ subject = '', bodyText = '', fromEmail = '', type = 'cancellatie' }) {
  const body = bodyText || '';
  const isCancellatie = type === 'cancellatie';

  console.log(`🚫 handleCancellatie [${type}]: ${subject}`);

  // Detecteer oud → nieuw datum-patroon voor wijzigingen
  // bijv. "van 12-05 naar 14-05" of "old date: ... new date: ..."
  let wijzigingTekst = '';
  if (!isCancellatie) {
    const oudNieuweMatch = body.match(
      /(?:van|from|old(?:\s+date)?)\s*:?\s*(.+?)\s*(?:\r?\n|naar|to|new(?:\s+date)?)\s*:?\s*(.+?)(?:\r?\n|$)/i
    );
    if (oudNieuweMatch) {
      wijzigingTekst = ` VAN ${oudNieuweMatch[1].trim().toUpperCase()} NAAR ${oudNieuweMatch[2].trim().toUpperCase()}`;
    }
  }

  // Bouw notificatie-email op
  const label = isCancellatie ? '❌ ANNULERING' : '⚠️ WIJZIGING';
  const kopregel = isCancellatie
    ? '⚠️ DEZE OPDRACHT IS GECANCELD'
    : `⚠️ DEZE OPDRACHT IS GEWIJZIGD${wijzigingTekst}`;

  const emailBody = [
    kopregel,
    '',
    `Van:      ${fromEmail}`,
    `Onderwerp: ${subject}`,
    '',
    '─'.repeat(60),
    '',
    body.slice(0, 1500)
  ].join('\n');

  try {
    const { transporter, from } = await getGmailTransporter();
    await transporter.sendMail({
      from,
      to:      RECIPIENT_EMAIL,
      subject: `${label}: ${subject}`,
      text:    emailBody
    });
    console.log(`📧 ${label} notificatie verstuurd: ${subject}`);
  } catch (err) {
    console.error(`❌ handleCancellatie: email versturen mislukt:`, err.message);
  }

  return [];
}
