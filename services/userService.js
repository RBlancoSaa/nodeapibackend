// services/userService.js
// CRUD voor gebruikers + tenant-membership + scrypt-wachtwoord-hashing.

import crypto from 'crypto';
import { promisify } from 'util';
import { supabase } from './supabaseClient.js';
import { sanitizePermissions } from '../utils/permissions.js';

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_KEYLEN = 64;

// ─── Wachtwoord-hashing (scrypt, geen externe dependency) ────────────────────
export async function hashPassword(password) {
  if (!password || typeof password !== 'string' || password.length < 4) {
    throw new Error('Wachtwoord moet minimaal 4 tekens zijn');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const buf  = await scryptAsync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt}$${buf.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!password || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hashHex] = parts;
  let buf;
  try { buf = await scryptAsync(password, salt, SCRYPT_KEYLEN); }
  catch { return false; }
  const expected = Buffer.from(hashHex, 'hex');
  if (buf.length !== expected.length) return false;
  return crypto.timingSafeEqual(buf, expected);
}

// ─── Bootstrap: maak superuser op basis van env-vars als nog geen users ──────
let bootstrapTried = false;
export async function ensureBootstrapUser() {
  if (bootstrapTried) return;
  bootstrapTried = true;
  const username = process.env.BOOTSTRAP_USERNAME;
  const password = process.env.BOOTSTRAP_PASSWORD;
  if (!username || !password) return;

  const { count, error } = await supabase
    .from('app_users').select('id', { count: 'exact', head: true });
  if (error) { console.error('[bootstrap] count error:', error.message); return; }
  if ((count || 0) > 0) return;

  console.log(`[bootstrap] Geen gebruikers gevonden — maak superuser '${username}' aan`);
  const password_hash = await hashPassword(password);
  const { error: insErr } = await supabase
    .from('app_users')
    .insert({ username, password_hash, is_superuser: true, is_active: true });
  if (insErr) console.error('[bootstrap] insert error:', insErr.message);
}

// ─── User CRUD ───────────────────────────────────────────────────────────────
export async function getUserById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('app_users').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function getUserByUsername(username) {
  if (!username) return null;
  const { data, error } = await supabase
    .from('app_users').select('*').ilike('username', username).maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function listUsers() {
  const { data, error } = await supabase
    .from('app_users').select('*').order('username');
  if (error) throw new Error(error.message);
  return data || [];
}

export async function listUsersForTenant(tenantId) {
  const { data, error } = await supabase
    .from('tenant_members')
    .select('user_id, is_owner, permissions, app_users!inner(id, username, is_active, is_superuser, last_login)')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    id:           r.app_users.id,
    username:     r.app_users.username,
    is_active:    r.app_users.is_active,
    is_superuser: r.app_users.is_superuser,
    last_login:   r.app_users.last_login,
    is_owner:     r.is_owner,
    permissions:  r.permissions || {},
  }));
}

export async function createUser({ username, password, is_superuser = false }) {
  if (!username) throw new Error('username verplicht');
  if (!password) throw new Error('wachtwoord verplicht');
  const cleaned = String(username).trim().toLowerCase();
  if (!/^[a-z0-9_.\-]{3,40}$/.test(cleaned)) {
    throw new Error('username mag alleen letters, cijfers, _, . of - bevatten (3-40 tekens)');
  }
  const existing = await getUserByUsername(cleaned);
  if (existing) throw new Error('username bestaat al');

  const password_hash = await hashPassword(password);
  const { data, error } = await supabase
    .from('app_users')
    .insert({ username: cleaned, password_hash, is_superuser, is_active: true })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateUser(id, patch) {
  const update = {};
  if ('is_active'    in patch) update.is_active    = !!patch.is_active;
  if ('is_superuser' in patch) update.is_superuser = !!patch.is_superuser;
  if (patch.password) update.password_hash = await hashPassword(patch.password);
  if (Object.keys(update).length === 0) return await getUserById(id);

  const { data, error } = await supabase
    .from('app_users').update(update).eq('id', id).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function setLastLogin(id) {
  await supabase.from('app_users')
    .update({ last_login: new Date().toISOString() })
    .eq('id', id);
}

// ─── Membership CRUD ─────────────────────────────────────────────────────────
export async function getMembership(userId, tenantId) {
  if (!userId || !tenantId) return null;
  const { data, error } = await supabase
    .from('tenant_members')
    .select('*')
    .eq('user_id', userId).eq('tenant_id', tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function listMembershipsForUser(userId) {
  const { data, error } = await supabase
    .from('tenant_members')
    .select('tenant_id, is_owner, permissions, tenants!inner(id, slug, name, is_active)')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({
    tenant_id:   r.tenant_id,
    is_owner:    r.is_owner,
    permissions: r.permissions || {},
    tenant:      r.tenants,
  }));
}

export async function upsertMembership({ user_id, tenant_id, is_owner = false, permissions = {} }) {
  const clean = {
    user_id, tenant_id,
    is_owner: !!is_owner,
    permissions: sanitizePermissions(permissions),
  };
  const { data, error } = await supabase
    .from('tenant_members')
    .upsert(clean, { onConflict: 'user_id,tenant_id' })
    .select().single();
  if (error) throw new Error(error.message);
  return data;
}

export async function removeMembership(user_id, tenant_id) {
  const { error } = await supabase
    .from('tenant_members')
    .delete()
    .eq('user_id', user_id).eq('tenant_id', tenant_id);
  if (error) throw new Error(error.message);
}
