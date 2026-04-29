// handlers/handleEimskip.js
// Eimskip transportopdrachten — parser wordt gebouwd zodra email-formaat bekend is
import { logOpdracht } from '../utils/logOpdracht.js';

export default async function handleEimskip({ buffer, base64, filename, mailSubject, mailFrom, bodyText, fromEmail = '' }) {
  console.warn(`⚠️ Eimskip email ontvangen maar parser nog niet geïmplementeerd`);
  console.log(`📧 Van: ${mailFrom || fromEmail}`);
  console.log(`📧 Onderwerp: ${mailSubject}`);
  console.log(`📄 Bestand: ${filename || '(geen bijlage)'}`);
  if (bodyText) console.log(`📝 Body (eerste 500): ${bodyText.slice(0, 500)}`);

  await logOpdracht({
    bron: 'Eimskip',
    afzenderEmail: mailFrom || fromEmail,
    bestandsnaam: filename || mailSubject || '',
    container: {},
    status: 'FOUT',
    foutmelding: 'Parser nog niet geïmplementeerd — email body gelogd in console'
  });

  return [];
}
