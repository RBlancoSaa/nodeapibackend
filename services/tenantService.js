// services/tenantService.js
// Lookup en lijst van tenants.

import { supabase } from './supabaseClient.js';

export async function listTenants({ activeOnly = true } = {}) {
  let q = supabase.from('tenants').select('*').order('name');
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getTenantBySlug(slug) {
  if (!slug) return null;
  const { data, error } = await supabase
    .from('tenants').select('*').eq('slug', String(slug).toLowerCase()).maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function getTenantById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('tenants').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * Maak een nieuwe tenant aan.
 * @param {object} opts { name, slug, is_active? }
 * @returns nieuwe tenant-rij of gooit Error
 */
export async function createTenant({ name, slug, is_active = true }) {
  if (!name || !slug) throw new Error('name en slug zijn verplicht');
  const cleanSlug = String(slug).toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
  if (!cleanSlug) throw new Error('slug bevat geen geldige tekens (alleen a-z, 0-9 en -)');

  const existing = await getTenantBySlug(cleanSlug);
  if (existing) throw new Error(`Tenant met slug '${cleanSlug}' bestaat al`);

  const { data, error } = await supabase
    .from('tenants')
    .insert({ name: name.trim(), slug: cleanSlug, is_active })
    .select().single();
  if (error) throw new Error('Tenant aanmaken mislukt: ' + error.message);
  return data;
}
