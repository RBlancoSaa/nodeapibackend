// handlers/handleEimskip.js
// Eimskip transportopdrachten — parser wordt gebouwd zodra email-formaat bekend is
import { logOpdracht } from '../utils/logOpdracht.js';

export default async function handleEimskip({ buffer, base64, filename, mailSubject, mailFrom, bodyText, fromEmail = '' }) {
  console.warn(`⚠️ Eimskip email ontvangen maar parser nog niet geïmplementeerd`);
  console.log(`📧 Van: ${mailFrom || fromEmail}`);
  console.log(`📧 Onderwerp: ${mailSubject}`);

  if (filename) {
    console.log(`📄 PDF-bijlage: ${filename} (${buffer ? Math.round(buffer.length / 1024) + ' KB' : 'geen buffer'})`);
  }

  if (bodyText) {
    console.log(`📝 Email body (eerste 1000 tekens):\n${bodyText.slice(0, 1000)}`);
  }

  await logOpdracht({
    bron: 'Eimskip',
    afzenderEmail: mailFrom || fromEmail,
    bestandsnaam: filename || mailSubject || '',
    container: {},
    status: 'FOUT',
    foutmelding: 'Parser nog niet geïmplementeerd — email body/PDF gelogd in console'
  });

  return [];
}
