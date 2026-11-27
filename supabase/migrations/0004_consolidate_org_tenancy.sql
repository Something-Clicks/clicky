-- DEVELOPMENT (clicky-dev) ONLY. Not applied to production.
-- Consolidation: the agent's working-data tables (sc_*) use the EXISTING tenancy (organizations / organization_members,
-- roles owner|member). business_id is the organization id as text. Duplicate tables the existing system replaces are dropped
-- (all verified empty; nothing references them): sc_businesses -> organizations + business_profiles, sc_members ->
-- organization_members, sc_billing -> subscriptions/purchases, sc_stripe_events/sc_previews -> server-only (need a protected credential).

drop table if exists public.sc_businesses, public.sc_members, public.sc_billing, public.sc_stripe_events, public.sc_previews;

create or replace function sc_private.is_member(bid text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members m
                 where m.organization_id::text = bid and m.user_id = (select auth.uid()));
$$;
create or replace function sc_private.has_role(bid text, roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members m
                 where m.organization_id::text = bid and m.user_id = (select auth.uid()) and m.role = any(roles));
$$;

-- Read policies already exist (is_member); the audit trail becomes owner-readable.
drop policy if exists sc_audit_admin_read on public.sc_audit;
create policy sc_audit_owner_read on public.sc_audit for select to authenticated using (sc_private.has_role(business_id, array['owner']));

-- Customer-session writes: members of the organization only. No deletes. Audit is append-only.
do $$
declare t text;
begin
  foreach t in array array['sc_sites','sc_profiles','sc_scans','sc_research','sc_findings','sc_cards','sc_deliverables','sc_strategies',
    'sc_campaigns','sc_execution_requests','sc_metrics','sc_reports','sc_workflows','sc_usage','sc_uses'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (sc_private.is_member(business_id))', t || '_member_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (sc_private.is_member(business_id)) with check (sc_private.is_member(business_id))', t || '_member_update', t);
    execute format('drop trigger if exists %I on public.%I', t || '_guard', t);
    execute format('create trigger %I before update on public.%I for each row execute function sc_private.guard_row()', t || '_guard', t);
  end loop;
end $$;
grant insert on public.sc_audit to authenticated;
drop policy if exists sc_audit_member_insert on public.sc_audit;
create policy sc_audit_member_insert on public.sc_audit for insert to authenticated with check (sc_private.is_member(business_id));
-- The usage ledger is the free-use / draft allowance: rows may only be written for yourself.
drop policy if exists sc_uses_member_insert on public.sc_uses;
create policy sc_uses_member_insert on public.sc_uses for insert to authenticated
  with check (sc_private.is_member(business_id) and data->>'userId' = (select auth.uid())::text);

-- Row identity is immutable; every update bumps version by exactly one; approvals and authorizations are owner-only.
create or replace function sc_private.guard_row() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.business_id is distinct from old.business_id or new.created_at is distinct from old.created_at then
    raise exception 'Row identity is immutable' using errcode = '23514';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'Version must increase by one' using errcode = '23514';
  end if;
  if tg_table_name in ('sc_deliverables', 'sc_strategies') and new.data->>'status' = 'approved' and old.data->>'status' is distinct from 'approved'
     and not sc_private.has_role(new.business_id, array['owner']) then
    raise exception 'Only an owner can approve' using errcode = '42501';
  end if;
  if tg_table_name = 'sc_execution_requests' and new.data->>'status' = 'authorized' and old.data->>'status' is distinct from 'authorized'
     and not sc_private.has_role(new.business_id, array['owner']) then
    raise exception 'Only an owner can authorize an action' using errcode = '42501';
  end if;
  return new;
end $$;

-- Plans: widen the id check, add the four product ids. Historical rows and mappings untouched.
alter table public.plan_entitlements drop constraint if exists plan_entitlements_plan_id_check;
alter table public.plan_entitlements add constraint plan_entitlements_plan_id_check check (plan_id = any (array[
  'diagnostic_audit','starter_ai','growth_ai','scale_automation','marketing_plan','single_site','business_plus','multi_site',
  'report','assistant','studio','suite']));
insert into public.plan_entitlements (plan_id, analyses, weekly, drafts, one_time) values
  ('report', true, false, 'none', true), ('assistant', true, true, 'meta', false),
  ('studio', true, true, 'all', false), ('suite', true, true, 'all', false)
on conflict (plan_id) do nothing;

-- Exact old -> new mapping used when reading billing (no row is rewritten). starter_ai/growth_ai/scale_automation are unmapped on purpose.
create or replace function app_private.canonical_plan(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'report' then 'report' when 'marketing_plan' then 'report' when 'diagnostic_audit' then 'report'
    when 'assistant' then 'assistant' when 'single_site' then 'assistant'
    when 'studio' then 'studio' when 'business_plus' then 'studio'
    when 'suite' then 'suite' when 'multi_site' then 'suite'
    else null end;
$$;
