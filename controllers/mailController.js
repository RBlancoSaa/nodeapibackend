import { checkInbox } from '../services/imapService.js';
import { createEasyFiles } from '../services/easyFileService.js';
import { sendMailWithEasyFiles } from '../services/mailService.js';

export async function getUnreadEmailsAndProcess(req, res) {
  try {
    const mails = await checkInbox();

    const easyFiles = await createEasyFiles(mails);

    await sendMailWithEasyFiles(easyFiles);

    res.json({ success: true, mailsCount: mails.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
}