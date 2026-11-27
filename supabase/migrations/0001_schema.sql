-- Something Clicks: tenant data model.
-- Every domain table is (id, business_id, version, created_at, updated_at, data jsonb) so the agent's
-- validated structures persist as-is, with optimistic-concurrency `version`. business_id is the tenant key
-- that every RLS policy is built on. The agent runs server-side with the service role and enforces its own
-- role checks; RLS protects every direct client (anon / authenticated) path.

create schema if not exists sc_private;

do $$
declare t text;
begin
  foreach t in array array[
    'sc_businesses','sc_sites','sc_members','sc_profiles','sc_scans','sc_research','sc_findings','sc_cards','sc_deliverables',
    'sc_strategies','sc_campaigns','sc_execution_requests','sc_metrics','sc_reports','sc_workflows','sc_audit',
    'sc_usage','sc_uses','sc_billing','sc_stripe_events','sc_previews'
  ] loop
    execute format($f$
      create table if not exists public.%I (
        id text primary key,
        business_id text not null,
        version integer not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        data jsonb not null default '{}'::jsonb
      )$f$, t);
    execute format('create index if not exists %I on public.%I (business_id, created_at desc)', t || '_biz_idx', t);
    execute format('create index if not exists %I on public.%I using gin (data jsonb_path_ops)', t || '_data_idx', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- Supabase's default privileges grant ALL on new public tables to anon/authenticated: remove them all, then grant back SELECT only where intended.
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Membership helpers (security definer so policies can read sc_members without recursion).
create or replace function sc_private.is_member(bid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sc_members m
                 where m.business_id = bid and m.data->>'userId' = auth.uid()::text);
$$;
create or replace function sc_private.has_role(bid text, roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sc_members m
                 where m.business_id = bid and m.data->>'userId' = auth.uid()::text and m.data->>'role' = any(roles));
$$;
grant usage on schema sc_private to authenticated;
grant execute on function sc_private.is_member(text), sc_private.has_role(text, text[]) to authenticated;

-- Members of a business can READ its data. Nobody can write through the Data API.
do $$
declare t text;
begin
  foreach t in array array[
    'sc_sites','sc_profiles','sc_scans','sc_research','sc_findings','sc_cards','sc_deliverables','sc_strategies','sc_campaigns',
    'sc_execution_requests','sc_metrics','sc_reports','sc_workflows','sc_usage','sc_uses','sc_billing'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (sc_private.is_member(business_id))', t || '_member_read', t);
  end loop;
end $$;

drop policy if exists sc_businesses_member_read on public.sc_businesses;
create policy sc_businesses_member_read on public.sc_businesses for select to authenticated using (sc_private.is_member(id));

-- You can see your own membership row, and owners/admins see their business's roster.
drop policy if exists sc_members_read on public.sc_members;
create policy sc_members_read on public.sc_members for select to authenticated
  using (data->>'userId' = auth.uid()::text or sc_private.has_role(business_id, array['owner','admin']));

-- The audit trail is visible to owners and admins only. It is append-only: no client policy allows writes.
drop policy if exists sc_audit_admin_read on public.sc_audit;
create policy sc_audit_admin_read on public.sc_audit for select to authenticated
  using (sc_private.has_role(business_id, array['owner','admin']));

-- sc_previews (anonymous previews) and sc_stripe_events: RLS on with NO policies = service role only.
-- Grant read access ONLY on this app's own tables. Never "all tables in schema public": the schema may hold other apps' tables
-- (their privileges must not change). sc_previews and sc_stripe_events get no grant at all (service role only).
do $$
declare t text;
begin
  foreach t in array array['sc_businesses','sc_sites','sc_members','sc_profiles','sc_scans','sc_research','sc_findings','sc_cards','sc_deliverables','sc_strategies','sc_campaigns','sc_execution_requests','sc_metrics','sc_reports','sc_workflows','sc_audit','sc_usage','sc_uses','sc_billing'] loop
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
