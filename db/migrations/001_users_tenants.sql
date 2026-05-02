-- 001_users_tenants.sql
-- Multi-tenant user system voor Automating Logistics.
-- Voer dit één keer uit in de Supabase SQL editor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tenants (transportbedrijven)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id          serial primary key,
  slug        text   unique not null,            -- URL slug, bv. 'tiarotransport'
  name        text   not null,                   -- weergavenaam, bv. 'Tiaro Transport BV'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Initiële tenants
insert into tenants (slug, name) values
  ('tiarotransport', 'Tiaro Transport BV'),
  ('rodin',          'Rodin'),
  ('pentor',         'Pentor')
on conflict (slug) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Gebruikers
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists app_users (
  id            serial primary key,
  username      text   unique not null,
  password_hash text   not null,                 -- 'scrypt$<salt>$<hash>'
  is_superuser  boolean not null default false,  -- ziet alle tenants (alleen Romy)
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login    timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Lidmaatschap: koppelt gebruiker aan tenant met permissies
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists tenant_members (
  user_id      int  not null references app_users(id) on delete cascade,
  tenant_id    int  not null references tenants(id)   on delete cascade,
  is_owner     boolean not null default false,        -- alle vinkjes voor deze tenant + gebruikersbeheer
  permissions  jsonb   not null default '{}',         -- losse vinkjes voor staff/viewer
  created_at   timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists tenant_members_tenant_idx on tenant_members(tenant_id);
create index if not exists tenant_members_user_idx   on tenant_members(user_id);
