// api/admin-tenants.js
//
// GET  /api/admin/tenants                       → lijst alle tenants (superuser)
// POST /api/admin/tenants                       → nieuwe tenant + admin user + membership
//
// Body voor POST:
//   { name, slug?, adminUsername, adminPassword?, isActive? }
// (slug wordt afgeleid van name als hij niet meegegeven is)
// (adminPassword wordt willekeurig gegenereerd als niet meegegeven)
//
// Response: { ok, tenant, adminUser: { username, password }, melding }
// LET OP: het wachtwoord komt ÉÉN keer terug — niet later opvraagbaar.

import crypto from 'crypto';
import { requireLogin } from '../utils/auth.js';
import {
  createUser, getUserByUsername, upsertMembership,
} from '../services/userService.js';
import {
  listTenants, createTenant, getTenantBySlug,
} from '../services/tenantService.js';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isServiceToken(req) {
  const cron = process.env.CRON_SECRET || '';
  const tok  = req.query?.token || req.headers?.['x-service-token'] || req.headers?.['x-token'] || '';
  return cron && tok && safeEqual(String(tok), cron);
}

function genereerWachtwoord(lengte = 14) {
  // 14 chars uit a-z, A-Z, 0-9 met goede entropie (~83 bits)
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(lengte);
  let out = '';
  for (let i = 0; i < lengte; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function slugify(name) {
  return String(name).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default async function handler(req, res) {
  // Service-token (CRON_SECRET) mag óók — voor Romy-HQ tenant-picker
  const viaService = isServiceToken(req);

  let user = null;
  if (!viaService) {
    user = await requireLogin(req, res, { json: true });
    if (!user) return;
    if (!user.is_superuser) {
      return res.status(403).json({ error: 'Alleen superusers mogen tenants beheren' });
    }
  }

  if (req.method === 'GET') {
    try {
      const tenants = await listTenants({ activeOnly: false });
      return res.json({ ok: true, tenants });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'POST') {
    let { name, slug, adminUsername, adminPassword, isActive = true } = req.body || {};
    if (!name || !adminUsername) {
      return res.status(400).json({ error: 'name en adminUsername zijn verplicht' });
    }
    if (!slug) slug = slugify(name);

    try {
      // Bestaat de username al elders? Niet erg — we kunnen een bestaande
      // user aan een nieuwe tenant koppelen — maar we waarschuwen wel.
      const bestaande = await getUserByUsername(adminUsername);
      let appUser, gegeneerdWachtwoord = null;

      if (bestaande) {
        appUser = bestaande;
      } else {
        if (!adminPassword) {
          adminPassword = genereerWachtwoord();
          gegeneerdWachtwoord = adminPassword;
        }
        appUser = await createUser({
          username: adminUsername,
          password: adminPassword,
          is_superuser: false,
        });
      }

      const tenant = await createTenant({ name, slug, is_active: isActive });

      // Maak membership met owner-rechten
      await upsertMembership({
        user_id: appUser.id,
        tenant_id: tenant.id,
        is_owner: true,
        permissions: null,  // owner heeft alle rechten
      });

      return res.status(201).json({
        ok: true,
        tenant: {
          id: tenant.id, name: tenant.name, slug: tenant.slug, is_active: tenant.is_active,
        },
        adminUser: {
          username: appUser.username,
          password: gegeneerdWachtwoord,   // null als bestaande user
          bestond_al: !!bestaande,
        },
        loginUrl: `/${tenant.slug}`,
        melding: bestaande
          ? `Bestaande user '${adminUsername}' is gekoppeld aan nieuwe tenant '${tenant.slug}'`
          : `Nieuwe tenant '${tenant.slug}' aangemaakt — kopieer wachtwoord nu, het is later niet meer opvraagbaar`,
      });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
