import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { checkInbox } from './services/imapService.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get('/check-inbox', async (req, res) => {
  try {
    console.log('Inbox check gestart...');
    const mails = await checkInbox();
    res.json({ success: true, mails });
  } catch (error) {
    console.error('Fout bij inbox check:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server draait op poort ${PORT}`));
