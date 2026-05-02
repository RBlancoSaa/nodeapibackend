// utils/permissions.js
// Centrale lijst van permissies + helper om effectieve permissies te bepalen.

export const PERMISSIONS = [
  // Dashboard-onderdelen (zichtbaarheid)
  { key: 'view_stats',         label: 'Statistieken bovenaan',       group: 'Bekijken' },
  { key: 'view_runs',          label: 'Runs / emails',                group: 'Bekijken' },
  { key: 'view_opdrachten',    label: 'Opdrachten',                   group: 'Bekijken' },
  { key: 'view_overgeslagen',  label: 'Overgeslagen emails',          group: 'Bekijken' },
  { key: 'view_fouten',        label: 'Fouten',                       group: 'Bekijken' },
  { key: 'view_klanten',       label: 'Klanten / bestemmingen',       group: 'Bekijken' },
  { key: 'view_tarieven',      label: 'Tarieven',                     group: 'Bekijken' },

  // Acties
  { key: 'edit_klanten',       label: 'Klanten bewerken',             group: 'Bewerken' },
  { key: 'edit_tarieven',      label: 'Tarieven bewerken',            group: 'Bewerken' },
  { key: 'trigger_inbox',      label: 'Handmatig inbox-run starten',  group: 'Acties'   },

  // Beheer
  { key: 'manage_users',       label: 'Gebruikers van deze tenant beheren', group: 'Beheer' },
];

export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key);

// Default permissies per "preset" (UI-gemak bij aanmaken nieuwe gebruiker)
export const PRESETS = {
  owner: {
    label: 'Owner — alle vinkjes voor deze tenant',
    is_owner: true,
    permissions: Object.fromEntries(PERMISSION_KEYS.map(k => [k, true])),
  },
  staff: {
    label: 'Medewerker — meeste dingen, geen tarieven',
    is_owner: false,
    permissions: {
      view_stats: true, view_runs: true, view_opdrachten: true,
      view_overgeslagen: true, view_fouten: true, view_klanten: true,
      edit_klanten: true, trigger_inbox: true,
    },
  },
  viewer: {
    label: 'Lezer — alleen opdrachten zien',
    is_owner: false,
    permissions: {
      view_opdrachten: true,
    },
  },
};

/**
 * Effectieve permissies van een user voor een tenant.
 * - Superuser → alle permissies + manage_users
 * - Owner van tenant → alle permissies + manage_users
 * - Anders → wat in tenant_members.permissions staat
 *
 * @param {object} user        — { id, is_superuser, ... }
 * @param {object|null} membership — tenant_members rij {is_owner, permissions} of null
 * @returns {object} object met permission keys → boolean
 */
export function effectivePermissions(user, membership) {
  if (user?.is_superuser) {
    return Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
  }
  if (!membership) {
    return Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));
  }
  if (membership.is_owner) {
    return Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
  }
  const perms = membership.permissions || {};
  return Object.fromEntries(PERMISSION_KEYS.map(k => [k, !!perms[k]]));
}

export function hasPermission(user, membership, permKey) {
  if (user?.is_superuser) return true;
  if (!membership) return false;
  if (membership.is_owner) return true;
  return !!(membership.permissions || {})[permKey];
}

// Sanitize: zorg dat een permissie-object alleen geldige keys bevat met booleans.
export function sanitizePermissions(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const key of PERMISSION_KEYS) {
    if (input[key]) out[key] = true;
  }
  return out;
}
