// api/login.js
// GET  → toont login-formulier (gebruikersnaam + wachtwoord)
// POST → verifieert tegen app_users, zet sessiecookie, redirect naar tenant

import {
  setSessionCookie,
  getCurrentUser,
  recordLogin,
} from '../utils/auth.js';
import {
  getUserByUsername,
  verifyPassword,
  ensureBootstrapUser,
  listMembershipsForUser,
} from '../services/userService.js';

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeNext(next) {
  if (!next || typeof next !== 'string') return '';
  if (!next.startsWith('/') || next.startsWith('//')) return '';
  return next;
}

async function defaultLandingFor(user) {
  if (user.is_superuser) return '/';
  const memberships = await listMembershipsForUser(user.id);
  const active = memberships.filter(m => m.tenant.is_active);
  if (active.length === 1) return `/${active[0].tenant.slug}`;
  return '/';
}

function renderLogin({ next, error, username }) {
  const errBlok = error ? `<div class="err">${esc(error)}</div>` : '';
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Automating Logistics — Inloggen</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',-apple-system,sans-serif;background:#1E1209;
       display:flex;align-items:center;justify-content:center;min-height:100vh;color:#F5F0E8;padding:20px}
  .card{background:#2E1A0B;border:1px solid #3D2A1A;border-radius:14px;
        padding:36px 32px;width:100%;max-width:380px;
        box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .logo{font-size:22px;font-weight:800;text-align:center;margin-bottom:4px;letter-spacing:-.5px}
  .logo span{color:#8B1A2E}
  .sub{text-align:center;color:#9E8A75;font-size:12px;margin-bottom:28px}
  label{display:block;font-size:11px;color:#9E8A75;margin:14px 0 6px;font-weight:600;
        text-transform:uppercase;letter-spacing:.5px}
  input[type=text],input[type=password]{width:100%;padding:12px 14px;border-radius:8px;
        border:1px solid #3D2A1A;background:#1E1209;color:#F5F0E8;
        font-size:15px;outline:none;transition:border-color .15s}
  input:focus{border-color:#8B1A2E}
  button{width:100%;margin-top:22px;padding:12px;background:#8B1A2E;color:white;
         border:none;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;
         transition:background .15s}
  button:hover{background:#6B1220}
  .err{background:#3a1212;border:1px solid #5a1818;color:#f4c4c4;
       padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:16px}
  .foot{margin-top:18px;font-size:11px;color:#6F5C46;text-align:center}
</style>
</head>
<body>
  <form class="card" method="POST" action="/api/login" autocomplete="off">
    <div class="logo">Automating <span>Logistics</span></div>
    <div class="sub">Beveiligde toegang</div>
    ${errBlok}
    <label for="u">Gebruikersnaam</label>
    <input id="u" name="username" type="text" value="${esc(username || '')}" autofocus required autocomplete="username">
    <label for="p">Wachtwoord</label>
    <input id="p" name="password" type="password" required autocomplete="current-password">
    <input type="hidden" name="next" value="${esc(next)}">
    <button type="submit">Inloggen</button>
    <div class="foot">Automating Logistics · Romy</div>
  </form>
</body>
</html>`;
}

export default async function handler(req, res) {
  await ensureBootstrapUser();

  // Al ingelogd? Direct doorsturen.
  const current = await getCurrentUser(req);
  if (current) {
    const target = safeNext(req.query?.next) || await defaultLandingFor(current);
    res.statusCode = 302;
    res.setHeader('Location', target);
    return res.end();
  }

  if (req.method === 'GET') {
    const next = safeNext(req.query?.next);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderLogin({ next, error: '', username: '' }));
  }

  if (req.method === 'POST') {
    const body     = req.body || {};
    const username = (body.username || '').trim().toLowerCase();
    const password = body.password || '';
    const next     = safeNext(body.next);

    const fail = (msg) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(401).send(renderLogin({ next, error: msg, username }));
    };

    if (!username || !password) return fail('Gebruikersnaam en wachtwoord vereist.');

    const user = await getUserByUsername(username);
    if (!user || !user.is_active) return fail('Onjuiste gebruikersnaam of wachtwoord.');

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return fail('Onjuiste gebruikersnaam of wachtwoord.');

    setSessionCookie(res, req, user.id);
    await recordLogin(user.id);

    const target = next || await defaultLandingFor(user);
    res.statusCode = 302;
    res.setHeader('Location', target);
    return res.end();
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
