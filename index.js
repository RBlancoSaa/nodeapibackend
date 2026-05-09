import 'dotenv/config';
import express from 'express';
import parsePdfHandler from './api/parse-uploaded-pdf.js';
import generateEasyHandler from './api/generate-easy-files.js';
import uploadFromInboxHandler from './api/upload-from-inbox.js';
import processSteinwegQueueHandler from './api/process-steinweg-queue.js';
import testSteinwegHandler from './api/test-steinweg.js';
import testGmailAuthHandler from './api/test-gmail-auth.js';
import testSendEmailHandler from './api/test-send-email.js';
import inspectPdfHandler from './api/inspect-pdf.js';
import dashboardHandler from './api/dashboard.js';
import prijsafsprakenHandler from './api/prijsafspraken.js';
import loginHandler from './api/login.js';
import logoutHandler from './api/logout.js';
import usersHandler from './api/users.js';
import { getCurrentUser, acceptCronToken } from './utils/auth.js';
import { listMembershipsForUser } from './services/userService.js';
import { listTenants } from './services/tenantService.js';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const app = express();

// ─── Security middleware ────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: alleen toegestane origins. Pas aan via ALLOWED_ORIGINS env (komma-gescheiden).
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    if (allowedOrigins.length === 0) return cb(null, true); // dev: alles toestaan
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS niet toegestaan'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel loginpogingen. Probeer over 15 minuten opnieuw.' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel verzoeken. Probeer later opnieuw.' },
});

// Wrapper: vereist een geldige cron-token (CRON_SECRET) op interne endpoints.
function requireCronAuth(req, res, next) {
  if (acceptCronToken(req, res, { json: true })) return next();
  // acceptCronToken heeft al een 401 gestuurd
}

const PORT = process.env.PORT || 3000;

// ─── Root: kies waar de gebruiker heen moet ─────────────────────────────────
app.get('/', async (req, res) => {
  // Legacy: ?token=... blijft werken (zet cookie via inbox-cron pad)
  if (req.query.token) {
    return res.redirect('/api/login?token=' + encodeURIComponent(req.query.token));
  }
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/api/login');

  // Superuser → tenant-picker
  if (user.is_superuser) {
    const tenants = await listTenants({ activeOnly: true });
    return renderPicker(res, user, tenants.map(t => ({
      slug: t.slug, name: t.name, role: 'superuser',
    })));
  }
  // Anders: zijn tenants
  const memberships = await listMembershipsForUser(user.id);
  const items = memberships
    .filter(m => m.tenant.is_active)
    .map(m => ({ slug: m.tenant.slug, name: m.tenant.name, role: m.is_owner ? 'owner' : 'medewerker' }));
  if (items.length === 1) return res.redirect('/' + items[0].slug);
  if (items.length === 0) return res.redirect('/api/login?next=/');
  return renderPicker(res, user, items);
});

function renderPicker(res, user, items) {
  const cards = items.map(i => `
    <a class="tile" href="/${encodeURIComponent(i.slug)}">
      <div class="tile-name">${escapeHtml(i.name)}</div>
      <div class="tile-role">${escapeHtml(i.role)}</div>
    </a>`).join('');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!DOCTYPE html>
<html lang="nl"><head><meta charset="UTF-8"><title>Automating Logistics</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#1E1209;color:#F5F0E8;min-height:100vh;padding:48px 20px}
.wrap{max-width:880px;margin:0 auto}
.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:36px}
.brand{font-size:22px;font-weight:800}.brand span{color:#8B1A2E}
.who{font-size:13px;color:#9E8A75}.who a{color:#F5F0E8;margin-left:14px}
h1{font-size:22px;margin-bottom:24px;font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.tile{display:block;padding:22px 20px;background:#2E1A0B;border:1px solid #3D2A1A;
       border-radius:12px;text-decoration:none;color:#F5F0E8;transition:all .15s}
.tile:hover{border-color:#8B1A2E;transform:translateY(-2px)}
.tile-name{font-size:16px;font-weight:600;margin-bottom:4px}
.tile-role{font-size:11px;color:#9E8A75;text-transform:uppercase;letter-spacing:.5px}
.empty{padding:32px;text-align:center;background:#2E1A0B;border:1px solid #3D2A1A;border-radius:12px;color:#9E8A75}
</style></head><body><div class="wrap">
<div class="head">
  <div class="brand">Automating <span>Logistics</span></div>
  <div class="who">${escapeHtml(user.username)}${user.is_superuser ? ' (superuser)' : ''}<a href="/api/logout">Uitloggen</a></div>
</div>
<h1>Kies een tenant</h1>
${items.length ? `<div class="grid">${cards}</div>` : `<div class="empty">Geen tenants toegewezen.</div>`}
</div></body></html>`);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── API routes ──────────────────────────────────────────────────────────────
app.post('/api/parse-uploaded-pdf', apiLimiter, parsePdfHandler);
app.post('/api/generate-easy-files', apiLimiter, generateEasyHandler);

// Cron / interne endpoints — vereisen CRON_SECRET token
app.get('/api/upload-from-inbox', requireCronAuth, uploadFromInboxHandler);
app.get('/api/process-steinweg-queue', requireCronAuth, processSteinwegQueueHandler);
app.get('/api/test-steinweg', requireCronAuth, testSteinwegHandler);
app.post('/api/test-steinweg', requireCronAuth, testSteinwegHandler);
app.get('/api/test-gmail-auth', requireCronAuth, testGmailAuthHandler);
app.get('/api/test-send-email', requireCronAuth, testSendEmailHandler);
app.get('/api/inspect-pdf', inspectPdfHandler);

app.get('/api/prijsafspraken', apiLimiter, prijsafsprakenHandler);
app.post('/api/prijsafspraken', apiLimiter, prijsafsprakenHandler);
app.get('/api/login', loginHandler);
app.post('/api/login', loginLimiter, loginHandler);
app.get('/api/logout', logoutHandler);
app.post('/api/logout', logoutHandler);
app.get('/api/users', apiLimiter, usersHandler);
app.post('/api/users', apiLimiter, usersHandler);
app.patch('/api/users', apiLimiter, usersHandler);
app.delete('/api/users', apiLimiter, usersHandler);

// Legacy: oude bookmark op /api/dashboard?token=... → vertaal naar tiaro slug
app.get('/api/dashboard', (req, res) => {
  const qs = req.query.token ? '?token=' + encodeURIComponent(req.query.token) : '';
  res.redirect('/tiarotransport' + qs);
});

// ─── Tenant slug routing — komt LAATST zodat /api/... voorrang heeft ────────
const RESERVED_SLUGS = new Set(['api', 'favicon.ico', 'robots.txt', 'admin', 'static', 'public']);
app.get('/:slug', (req, res, next) => {
  const slug = req.params.slug;
  if (RESERVED_SLUGS.has(slug)) return next();
  return dashboardHandler(req, res);
});

// Lokaal draaien: start de server
// Op Vercel: app wordt geëxporteerd en via vercel.json gerouteerd (geen listen nodig)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server draait op poort ${PORT}`);
  });
}

export default app;
