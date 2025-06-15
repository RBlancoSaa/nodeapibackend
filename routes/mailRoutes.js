import express from 'express';
import { checkInbox } from '../services/imapService.js';

const router = express.Router();

router.get('/check-inbox', async (req, res) => {
  try {
    const mails = await checkInbox();
    res.json({ success: true, mails });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;