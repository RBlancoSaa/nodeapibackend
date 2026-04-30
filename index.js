import 'dotenv/config';
import express from 'express';
import parsePdfHandler from './api/parse-uploaded-pdf.js';
import generateEasyHandler from './api/generate-easy-files.js';
import uploadFromInboxHandler from './api/upload-from-inbox.js';
import processSteinwegQueueHandler from './api/process-steinweg-queue.js';
import testSteinwegHandler from './api/test-steinweg.js';
import inspectPdfHandler from './api/inspect-pdf.js';
import dashboardHandler from './api/dashboard.js';
import prijsafsprakenHandler from './api/prijsafspraken.js';

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.redirect('/api/dashboard' + (req.query.token ? '?token=' + encodeURIComponent(req.query.token) : '')));

app.post('/api/parse-uploaded-pdf', parsePdfHandler);
app.post('/api/generate-easy-files', generateEasyHandler);
app.get('/api/upload-from-inbox', uploadFromInboxHandler);
app.get('/api/process-steinweg-queue', processSteinwegQueueHandler);
app.get('/api/test-steinweg', testSteinwegHandler);
app.post('/api/test-steinweg', testSteinwegHandler);
app.get('/api/inspect-pdf', inspectPdfHandler);
app.get('/api/dashboard', dashboardHandler);
app.get('/api/prijsafspraken', prijsafsprakenHandler);
app.post('/api/prijsafspraken', prijsafsprakenHandler);

// Lokaal draaien: start de server
// Op Vercel: app wordt geëxporteerd en via vercel.json gerouteerd (geen listen nodig)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT}`);
  });
}

export default app;
