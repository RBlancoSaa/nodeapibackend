// utils/csrf.js
// Double-submit cookie CSRF protection.
// GET endpoint zet een cookie + geeft het token terug voor in een hidden form field.
// POST endpoint vergelijkt cookie en form field (constant-time).

import crypto from 'crypto';
import { safeEqual } from './auth.js';

const CSRF_COOKIE = 'et_csrf';
const CSRF_FIELD  = '_csrf';

function isSecureRequest(req) {
  if (req.secure) return true;
  if (req.headers?.['x-forwarded-proto'] === 'https') return true;
  if (process.env.VERCEL) return true;
  return false;
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

export function issueCsrfToken(res, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const parts = [
    `${CSRF_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/', 'SameSite=Lax', 'Max-Age=3600',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  // Bewust GEEN HttpOnly: client moet token kunnen lezen voor JS-submits.
  // Voor server-side rendered formulieren wordt het token alsnog in een hidden
  // field gezet via getCsrfToken().
  res.setHeader('Set-Cookie', parts.join('; '));
  return token;
}

export function getCsrfToken(req, res) {
  const cookies = parseCookies(req);
  const existing = cookies[CSRF_COOKIE];
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  return issueCsrfToken(res, req);
}

export function verifyCsrf(req) {
  const cookies = parseCookies(req);
  const cookieToken = cookies[CSRF_COOKIE];
  const bodyToken = req.body?.[CSRF_FIELD] || req.headers?.['x-csrf-token'];
  if (!cookieToken || !bodyToken) return false;
  if (cookieToken.length !== bodyToken.length) return false;
  return safeEqual(cookieToken, bodyToken);
}

export const CSRF = { cookie: CSRF_COOKIE, field: CSRF_FIELD };
