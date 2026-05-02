// api/users.js
// REST-API voor gebruikersbeheer binnen één tenant.
//
// GET    /api/users?tenant=<slug>           → lijst gebruikers van die tenant
// POST   /api/users?tenant=<slug>           → nieuwe gebruiker + membership
//          body: { username, password, is_owner?, permissions? }
// PATCH  /api/users?tenant=<slug>&id=<id>   → permissies of owner-vlag aanpassen
//          body: { is_owner?, permissions?, password?, is_active? }
// DELETE /api/users?tenant=<slug>&id=<id>   → membership verwijderen
//
// Toegang: superuser, owner van tenant, of `manage_users`.

import { requireLogin } from '../utils/auth.js';
import {
  getUserById,
  getUserByUsername,
  createUser,
  updateUser,
  upsertMembership,
  removeMembership,
  getMembership,
  listUsersForTenant,
} from '../services/userService.js';
import { getTenantBySlug } from '../services/tenantService.js';
import { hasPermission, sanitizePermissions } from '../utils/permissions.js';

async function loadCtx(req, res) {
  const user = await requireLogin(req, res, { json: true });
  if (!user) return null;

  const slug = (req.query?.tenant || '').toString();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    res.status(404).json({ error: 'Onbekende tenant' });
    return null;
  }

  const membership = await getMembership(user.id, tenant.id);
  const canManage =
    user.is_superuser ||
    membership?.is_owner ||
    hasPermission(user, membership, 'manage_users');

  if (!canManage) {
    res.status(403).json({ error: 'Geen toestemming om gebruikers te beheren' });
    return null;
  }
  return { user, tenant, membership };
}

export default async function handler(req, res) {
  const ctx = await loadCtx(req, res);
  if (!ctx) return;
  const { user: actor, tenant } = ctx;

  try {
    if (req.method === 'GET') {
      const users = await listUsersForTenant(tenant.id);
      // Niet-superusers mogen geen superusers zien
      const visible = actor.is_superuser
        ? users
        : users.filter(u => !u.is_superuser);
      return res.status(200).json({ tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, users: visible });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const username    = (body.username || '').trim().toLowerCase();
      const password    = body.password || '';
      const is_owner    = !!body.is_owner;
      const permissions = sanitizePermissions(body.permissions || {});

      if (!username || !password) {
        return res.status(400).json({ error: 'username en password verplicht' });
      }

      // Alleen superuser mag een nieuwe owner aanmaken via niet-superuser pad?
      // We staan toe: owner of een tenant mag andere owner van diezelfde tenant maken.
      // Niemand behalve superuser mag een nieuwe global superuser maken.
      // (is_superuser kan hier niet meegegeven worden — check createUser API.)

      let appUser = await getUserByUsername(username);
      if (!appUser) {
        appUser = await createUser({ username, password, is_superuser: false });
      } else {
        // Bestaande user — alleen wachtwoord resetten als expliciet gevraagd
        if (body.password) await updateUser(appUser.id, { password });
      }

      const member = await upsertMembership({
        user_id:   appUser.id,
        tenant_id: tenant.id,
        is_owner,
        permissions,
      });

      return res.status(200).json({
        ok: true,
        user: {
          id: appUser.id, username: appUser.username,
          is_active: appUser.is_active, is_superuser: appUser.is_superuser,
          is_owner: member.is_owner, permissions: member.permissions,
        },
      });
    }

    if (req.method === 'PATCH') {
      const id = parseInt(req.query?.id, 10);
      if (!id) return res.status(400).json({ error: 'id verplicht' });
      const target = await getUserById(id);
      if (!target) return res.status(404).json({ error: 'gebruiker niet gevonden' });

      // Niet-superuser mag superusers niet aanpassen
      if (target.is_superuser && !actor.is_superuser) {
        return res.status(403).json({ error: 'Geen toestemming voor deze gebruiker' });
      }
      // Niet jezelf je eigen owner-rechten ontnemen (om niet uitgesloten te raken)
      if (target.id === actor.id && req.body?.is_owner === false) {
        return res.status(400).json({ error: 'Je kunt jezelf niet de owner-rol ontnemen' });
      }

      const body = req.body || {};
      const userPatch = {};
      if (body.password)           userPatch.password   = body.password;
      if (typeof body.is_active === 'boolean') userPatch.is_active = body.is_active;
      if (Object.keys(userPatch).length) await updateUser(id, userPatch);

      // Membership patch
      const membershipPatch = {
        user_id: id,
        tenant_id: tenant.id,
        is_owner: body.is_owner ?? (await getMembership(id, tenant.id))?.is_owner ?? false,
        permissions: body.permissions != null
          ? sanitizePermissions(body.permissions)
          : ((await getMembership(id, tenant.id))?.permissions || {}),
      };
      const member = await upsertMembership(membershipPatch);

      return res.status(200).json({
        ok: true,
        user: { id: target.id, username: target.username, is_owner: member.is_owner, permissions: member.permissions },
      });
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query?.id, 10);
      if (!id) return res.status(400).json({ error: 'id verplicht' });
      if (id === actor.id) return res.status(400).json({ error: 'Je kunt jezelf niet verwijderen' });
      const target = await getUserById(id);
      if (target?.is_superuser && !actor.is_superuser) {
        return res.status(403).json({ error: 'Geen toestemming voor deze gebruiker' });
      }
      await removeMembership(id, tenant.id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[users] error:', err);
    return res.status(500).json({ error: err.message || 'Serverfout' });
  }
}
