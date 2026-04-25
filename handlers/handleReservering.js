// handlers/handleReservering.js
import '../utils/fsPatch.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import parseReservering from '../parsers/parseReservering.js';
import { generateXmlFromJson } from '../services/generateXmlFromJson.js';
import { getGmailTransporter } from '../utils/gmailTransport.js';

export default async function handleReservering({ subject, bodyText, from, date }) {
  console.log(`📋 Reservering email verwerken: "${subject}" van ${from}`);

  const containers = parseReservering({ subject, bodyText, from, date });
  if (!containers || containers.length === 0) {
    console.warn('⚠️ parseReservering gaf geen resultaat');
    return;
  }

  const { transporter, from: fromAddr } = await getGmailTransporter();
  const container = containers[0];

  if (!container.datum) {
    console.warn('⚠️ Geen datum gevonden in reservering email — .easy wordt niet aangemaakt');
    return;
  }

  try {
    const xml = await generateXmlFromJson(container);
    const datumTag = container.datum.replace(/[-\/]/g, '');
    const klantTag = (container.klantnaam || 'reservering').replace(/[^\w\d]/g, '_').slice(0, 20);
    const easyFilename = `Reservering_${datumTag}_${klantTag}.easy`;
    const easyPath = path.join(os.tmpdir(), easyFilename);
    fs.writeFileSync(easyPath, Buffer.from(xml, 'utf-8'));

    const to = process.env.RECIPIENT_EMAIL || fromAddr;
    await transporter.sendMail({
      from: fromAddr,
      to,
      subject: `reservering - ${container.datum} - ${container.klantnaam}`,
      text: `Reservering ontvangen van ${from}.\nDatum: ${container.datum}\nKlant: ${container.klantnaam}\n\nOriginele email:\n${bodyText || '(geen tekst)'}`,
      attachments: [{ filename: easyFilename, path: easyPath }]
    });

    console.log(`✅ Reservering .easy verstuurd: ${easyFilename}`);
  } catch (err) {
    console.error('❌ handleReservering fout:', err.message);
  }
}
