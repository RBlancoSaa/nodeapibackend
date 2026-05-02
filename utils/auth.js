// utils/auth.js
// Sessie-cookie via HMAC + requireLogin middleware.
// Geen extra dependencies — gebruikt enkel Node's crypto.

import crypto from 'crypto';

const COOKIE_NAME    = 'et_session';
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagen

function getSecret() {
  return process.env.SESSION_SECRET || process.env.CRON_SECRET || '';
}

function getPassword() {
  return process.env.LOGIN_PASSWORD || process.env.CRON_SECRET || '';
}

function b64u(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64').toString('utf8');
}

function hmac(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function signSession(user = 'admin') {
  const secret = getSecret();
  if (!secret) throw new Error('SESSION_SECRET / CRON_SECRET niet geconfigureerd');
  const payload = b64u(JSON.stringify({ u: user, exp: Date.now() + SESSION_MAX_MS }));
  return `${payload}.${hmac(payload)}`;
}

export function verifySession(value) {
  if (!value || typeof value !== 'string') return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return null;
  const expected = hmac(payload);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(b64uDecode(payload));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return verifySession(cookies[COOKIE_NAME]);
}

function isSecureRequest(req) {
  if (req.secure) return true;
  if (req.headers?.['x-forwarded-proto'] === 'https') return true;
  if (process.env.VERCEL) return true;
  return false;
}

export function setSessionCookie(res, req, user = 'admin') {
  const value = signSession(user);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MAX_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res, req) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// Constant-time string compare (safe voor wachtwoord-vergelijking).
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function checkPassword(input) {
  const pw = getPassword();
  if (!pw) return false;
  return safeEqual(input || '', pw);
}

/**
 * requireLogin — geeft true als de gebruiker geauthenticeerd is via:
 *   - geldige sessie-cookie, OF
 *   - ?token= / x-token header die overeenkomt met CRON_SECRET (cron + legacy).
 *
 * Bij een geldige token-auth zonder cookie wordt de cookie automatisch gezet,
 * zodat vervolgnavigatie via cookie loopt en de token niet meer in de URL hoeft.
 *
 * Bij geen auth: rendert (afhankelijk van opts.json) een 401 JSON of redirect
 * naar de loginpagina, en geeft false terug.
 */
export function requireLogin(req, res, opts = {}) {
  const session = getSessionFromRequest(req);
  if (session) return true;

  const token = req.query?.token || req.headers?.['x-token'] || '';
  const cron  = process.env.CRON_SECRET || '';
  if (cron && token && safeEqual(token, cron)) {
    setSessionCookie(res, req, 'admin');
    return true;
  }

  if (opts.json) {
    res.status(401).json({ error: 'Niet geautoriseerd' });
  } else {
    const next = req.originalUrl || req.url || '/api/dashboard';
    res.statusCode = 302;
    res.setHeader('Location', `/api/login?next=${encodeURIComponent(next)}`);
    res.end();
  }
  return false;
}

export const COOKIE = { name: COOKIE_NAME, maxAgeMs: SESSION_MAX_MS };
