import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { checkInbox } from './services/imapService.js';

dotenv.config();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// Simpel test endpoint
app.get('/', (req, res) => {
  res.send('API is live');
});

// Endpoint om inbox te checken via HTTP GET
app.get('/check-inbox', async (req, res) => {
  try {
    console.log('Inbox check gestart via /check-inbox endpoint');
    await checkInbox();
    console.log('Inbox check voltooid');
    res.json({ success: true, message: 'Inbox check voltooid' });
  } catch (error) {
    console.error('Fout in inbox check:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server draait op poort ${PORT}`);
});