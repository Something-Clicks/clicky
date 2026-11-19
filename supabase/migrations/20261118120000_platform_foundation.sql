-- Phase 1: platform foundation.
--
-- Tables: profiles, organizations, organization_members, business_profiles,
--         platform_admins, activity_log.
--
-- Security model
--   * RLS is enabled on every table. Default deny: a table with no policy for a
--     role returns nothing to that role.
--   * API roles (anon, authenticated) lose every table privilege first, then get
--     back only the exact privileges their policies need. A policy mistake
--     alone cannot open a write path.
--   * Organization creation, admin access and activity logging go through
--     SECURITY DEFINER functions that check the caller and write activity_log.
--   * Helper functions live in app_private, which the Data API does not expose.

-- ── private schema and helpers ───────────────────────────────────────────────
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;

create function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── tables ───────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (full_name is null or length(btrim(full_name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organizations_created_by_idx on public.organizations (created_by);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.business_profiles (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  business_name text not null check (length(btrim(business_name)) between 1 and 160),
  website text check (
    website is null
    or (length(website) <= 300 and website ~* '^https?://[^\s/@]+\.[^\s/@]+(/\S*)?$')
  ),
  service_area text check (service_area is null or length(btrim(service_area)) between 1 and 160),
  primary_goal text check (primary_goal is null or primary_goal in ('get_found', 'more_calls', 'easier_marketing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text check (note is null or length(note) <= 200),
  granted_at timestamptz not null default now()
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  -- Null for platform-level events (admin access). Those are never visible to customers.
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type text,
  target_id text,
  -- Field names and identifiers only; never secrets or full personal data.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_log_org_idx on public.activity_log (organization_id, created_at desc);
create index activity_log_actor_idx on public.activity_log (actor_id);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function app_private.touch_updated_at();
create trigger organizations_updated_at before update on public.organizations
  for each row execute function app_private.touch_updated_at();
create trigger business_profiles_updated_at before update on public.business_profiles
  for each row execute function app_private.touch_updated_at();

-- ── membership helpers (SECURITY DEFINER so policies do not recurse) ─────────
create function app_private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = (select auth.uid()));
$$;

create function app_private.has_org_role(p_org uuid, p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.role = p_role);
$$;

create function app_private.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user);
$$;

create function app_private.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

create function app_private.log_activity(
  p_org uuid, p_action text, p_target_type text, p_target_id text, p_metadata jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.activity_log (organization_id, actor_id, action, target_type, target_id, metadata)
  values (p_org, (select auth.uid()), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;

revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_org_member(uuid) to authenticated;
grant execute on function app_private.has_org_role(uuid, text) to authenticated;
grant execute on function app_private.shares_org_with(uuid) to authenticated;
grant execute on function app_private.is_platform_admin() to authenticated;

-- ── audit triggers: changes are logged whatever path made them ────────────────
create function app_private.audit_business_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_fields text[] := array[]::text[];
begin
  if new.business_name is distinct from old.business_name then v_fields := array_append(v_fields, 'business_name'); end if;
  if new.website is distinct from old.website then v_fields := array_append(v_fields, 'website'); end if;
  if new.service_area is distinct from old.service_area then v_fields := array_append(v_fields, 'service_area'); end if;
  if new.primary_goal is distinct from old.primary_goal then v_fields := array_append(v_fields, 'primary_goal'); end if;
  if cardinality(v_fields) > 0 then
    perform app_private.log_activity(new.organization_id, 'business_profile.updated',
      'business_profile', new.organization_id::text, jsonb_build_object('fields', v_fields));
  end if;
  return new;
end $$;
create trigger business_profiles_audit after update on public.business_profiles
  for each row execute function app_private.audit_business_profile();

create function app_private.audit_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.name is distinct from old.name then
    perform app_private.log_activity(new.id, 'organization.renamed', 'organization', new.id::text, '{}'::jsonb);
  end if;
  return new;
end $$;
create trigger organizations_audit after update on public.organizations
  for each row execute function app_private.audit_organization();

-- A profile row for every new auth user.
create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

revoke all on function app_private.touch_updated_at(), app_private.log_activity(uuid, text, text, text, jsonb),
  app_private.audit_business_profile(), app_private.audit_organization(), app_private.handle_new_user()
  from public, anon, authenticated;

-- ── privileges: start from nothing, grant back only what policies use ────────
revoke all on public.profiles, public.organizations, public.organization_members,
  public.business_profiles, public.platform_admins, public.activity_log
  from anon, authenticated;

grant select on public.profiles, public.organizations, public.organization_members,
  public.business_profiles, public.activity_log to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (name) on public.organizations to authenticated;
grant update (business_name, website, service_area, primary_goal) on public.business_profiles to authenticated;
-- platform_admins: no API privileges at all.

-- ── row level security ───────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.business_profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.activity_log enable row level security;

create policy "Read own profile or teammates" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app_private.shares_org_with(id));
create policy "Update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "Members read their organizations" on public.organizations for select to authenticated
  using (app_private.is_org_member(id));
create policy "Owners update their organizations" on public.organizations for update to authenticated
  using (app_private.has_org_role(id, 'owner')) with check (app_private.has_org_role(id, 'owner'));

create policy "Members read their organization's members" on public.organization_members
  for select to authenticated using (app_private.is_org_member(organization_id));

create policy "Members read their business profile" on public.business_profiles for select to authenticated
  using (app_private.is_org_member(organization_id));
create policy "Owners update their business profile" on public.business_profiles for update to authenticated
  using (app_private.has_org_role(organization_id, 'owner'))
  with check (app_private.has_org_role(organization_id, 'owner'));

create policy "Members read their organization's activity" on public.activity_log for select to authenticated
  using (organization_id is not null and app_private.is_org_member(organization_id));

-- ── API functions ────────────────────────────────────────────────────────────

-- Creates an organization, makes the caller its owner, and saves the business
-- profile, in one transaction. A user can create at most 5 organizations.
create function public.create_organization(
  p_business_name text, p_website text, p_service_area text, p_primary_goal text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_name text := btrim(coalesce(p_business_name, ''));
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if (select count(*) from public.organization_members m
      where m.user_id = v_uid and m.role = 'owner') >= 5 then
    raise exception 'Organization limit reached' using errcode = 'P0001';
  end if;

  insert into public.organizations (name, created_by) values (v_name, v_uid) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into public.business_profiles (organization_id, business_name, website, service_area, primary_goal)
  values (v_org, v_name, nullif(btrim(p_website), ''), nullif(btrim(p_service_area), ''), nullif(p_primary_goal, ''));
  perform app_private.log_activity(v_org, 'organization.created', 'organization', v_org::text, '{}'::jsonb);
  return v_org;
end $$;

create function public.current_user_is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.is_platform_admin();
$$;

-- Platform overview for admins. Returns counts and organization names only, no
-- business details or personal data. Every call is logged.
create function public.admin_overview() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not app_private.is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform app_private.log_activity(null, 'admin.overview_viewed', null, null, '{}'::jsonb);
  select jsonb_build_object(
    'organization_count', (select count(*) from public.organizations),
    'user_count', (select count(*) from public.profiles),
    'organizations', coalesce((
      select jsonb_agg(row_to_json(o)) from (
        select org.id, org.name, org.created_at,
               (select count(*) from public.organization_members m where m.organization_id = org.id) as member_count
        from public.organizations org order by org.created_at desc limit 50) o), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.create_organization(text, text, text, text),
  public.current_user_is_platform_admin(), public.admin_overview()
  from public, anon, authenticated;
grant execute on function public.create_organization(text, text, text, text),
  public.current_user_is_platform_admin(), public.admin_overview()
  to authenticated;
