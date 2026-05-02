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
