// utils/auth.js
// HMAC-getekende sessiecookie met user_id + middleware voor login/permissies.

import crypto from 'crypto';
import {
  getUserById,
  setLastLogin,
  getMembership,
  ensureBootstrapUser,
} from '../services/userService.js';
import { getTenantBySlug } from '../services/tenantService.js';
import { hasPermission } from './permissions.js';

const COOKIE_NAME    = 'et_session';
const SESSION_MAX_MS = 30 * 24 * 60 * 60 * 1000; // 30 dagen

function getSecret() {
  return process.env.SESSION_SECRET || process.env.CRON_SECRET || '';
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

// Session-payload: { id (user_id), exp }
export function signSession(userId) {
  const secret = getSecret();
  if (!secret) throw new Error('SESSION_SECRET / CRON_SECRET niet geconfigureerd');
  const payload = b64u(JSON.stringify({ id: userId, exp: Date.now() + SESSION_MAX_MS }));
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
  } catch { return null; }
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

function isSecureRequest(req) {
  if (req.secure) return true;
  if (req.headers?.['x-forwarded-proto'] === 'https') return true;
  if (process.env.VERCEL) return true;
  return false;
}

export function setSessionCookie(res, req, userId) {
  const value = signSession(userId);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MAX_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res, req) {
  const parts = [
    `${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0',
  ];
  if (isSecureRequest(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ─── Auth middleware ─────────────────────────────────────────────────────────

/**
 * Laad de huidige gebruiker uit de sessiecookie. Geeft user-row terug of null.
 * Cachet binnen één request via req._authUser.
 */
export async function getCurrentUser(req) {
  if (req._authUser !== undefined) return req._authUser;
  await ensureBootstrapUser();

  const cookies = parseCookies(req);
  const session = verifySession(cookies[COOKIE_NAME]);
  if (!session?.id) { req._authUser = null; return null; }

  const user = await getUserById(session.id);
  if (!user || !user.is_active) { req._authUser = null; return null; }
  req._authUser = user;
  return user;
}

/**
 * Zorgt dat er een ingelogde user is. Bij geen auth: 401 (json) of redirect
 * naar /api/login (html). Geeft user-object terug of null als niet ingelogd.
 *
 * Legacy `?token=CRON_SECRET` blijft werken voor cron-routes (zie acceptCronToken).
 */
export async function requireLogin(req, res, opts = {}) {
  const user = await getCurrentUser(req);
  if (user) return user;

  if (opts.json) {
    res.status(401).json({ error: 'Niet ingelogd' });
  } else {
    const next = req.originalUrl || req.url || '/';
    res.statusCode = 302;
    res.setHeader('Location', `/api/login?next=${encodeURIComponent(next)}`);
    res.end();
  }
  return null;
}

/**
 * Voor cron-endpoints (upload-from-inbox, process-steinweg-queue):
 * accepteert ?token=CRON_SECRET zonder dat er een user-sessie nodig is.
 */
export function acceptCronToken(req, res, opts = {}) {
  const cron  = process.env.CRON_SECRET || '';
  const token = req.query?.token || req.headers?.['x-token'] || '';
  if (cron && token && safeEqual(token, cron)) return true;

  if (opts.json) res.status(401).json({ error: 'Niet geautoriseerd' });
  else { res.statusCode = 401; res.end('Niet geautoriseerd'); }
  return false;
}

/**
 * Permissie-check op een tenant. Gebruik:
 *   const ctx = await requirePermission(req, res, 'view_opdrachten', tenantSlug);
 *   if (!ctx) return;
 *   // ctx = { user, tenant, membership }
 */
export async function requirePermission(req, res, permKey, tenantSlug, opts = {}) {
  const user = await requireLogin(req, res, opts);
  if (!user) return null;

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    if (opts.json) res.status(404).json({ error: 'Onbekende tenant' });
    else res.status(404).send(notFoundPage(tenantSlug));
    return null;
  }

  const membership = await getMembership(user.id, tenant.id);
  if (!hasPermission(user, membership, permKey)) {
    if (opts.json) res.status(403).json({ error: 'Geen toestemming' });
    else res.status(403).send(forbiddenPage(tenant.name, permKey));
    return null;
  }
  return { user, tenant, membership };
}

/**
 * Soft check: laadt user + tenant + membership zonder per-key check (voor het
 * dashboard zelf — dat rendert tabs op basis van losse permissies).
 * De minimum-eis is dat user lid is van tenant (of superuser).
 */
export async function requireTenantAccess(req, res, tenantSlug, opts = {}) {
  const user = await requireLogin(req, res, opts);
  if (!user) return null;

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    if (opts.json) res.status(404).json({ error: 'Onbekende tenant' });
    else res.status(404).send(notFoundPage(tenantSlug));
    return null;
  }

  const membership = await getMembership(user.id, tenant.id);
  if (!user.is_superuser && !membership) {
    if (opts.json) res.status(403).json({ error: 'Geen toegang tot deze tenant' });
    else res.status(403).send(forbiddenPage(tenant.name, 'tenant_access'));
    return null;
  }
  return { user, tenant, membership };
}

export async function recordLogin(userId) {
  try { await setLastLogin(userId); } catch {}
}

// ─── Helper-pagina's voor 403/404 ────────────────────────────────────────────
function shellPage(title, body) {
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:'Segoe UI',sans-serif;background:#1E1209;color:#F5F0E8;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
.box{max-width:480px;text-align:center;background:#2E1A0B;padding:40px;border-radius:12px;border:1px solid #3D2A1A}
h1{color:#8B1A2E;margin:0 0 12px}p{color:#9E8A75;margin:8px 0}a{color:#F5F0E8}
</style></head><body><div class="box">${body}</div></body></html>`;
}
function forbiddenPage(tenantName, perm) {
  return shellPage('Geen toestemming', `
    <h1>403 — Geen toestemming</h1>
    <p>Je bent ingelogd, maar hebt geen recht op dit onderdeel van <b>${tenantName}</b>.</p>
    <p>Vereist: <code>${perm}</code></p>
    <p><a href="/">Terug</a> · <a href="/api/logout">Uitloggen</a></p>`);
}
function notFoundPage(slug) {
  return shellPage('Onbekend', `
    <h1>404 — Tenant niet gevonden</h1>
    <p>Slug <code>${String(slug).replace(/[<>&]/g,'')}</code> bestaat niet.</p>
    <p><a href="/">Terug</a></p>`);
}

export const COOKIE = { name: COOKIE_NAME, maxAgeMs: SESSION_MAX_MS };
