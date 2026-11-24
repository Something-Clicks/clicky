-- Rollback for 20261124120000_launch_redesign.sql. NOT a migration: run by hand only
-- if the launch migration must be undone. It restores the four replaced functions to
-- their previous definitions and drops everything the migration added.
--
-- Data loss on rollback: previews, feedback, follow-up permissions, funnel counts,
-- app_config, ZIP codes, free_use flags, subscription interval/price columns, and the
-- four new plan_entitlements rows. Subscriptions or purchases that reference the new
-- plan ids must be removed or remapped first, or the plan_entitlements delete fails
-- (foreign key) and the transaction stops with nothing changed.

begin;

drop function if exists public.admin_funnel(int);
drop function if exists public.site_track(text, text, jsonb);
drop function if exists public.site_submit_feedback(text, text, text, text, uuid, uuid, text, text);
drop function if exists public.claim_preview(text);
drop function if exists app_private.copy_preview_into(uuid, uuid, uuid);
drop function if exists public.site_preview_save(text, uuid, text, text, text);
drop function if exists public.site_preview_get(text, uuid, text);
drop function if exists public.site_preview_fail(text, uuid, text);
drop function if exists public.site_preview_complete(text, uuid, jsonb, jsonb, jsonb, text, text);
drop function if exists public.site_preview_start(text, text, text, text, text, text);
drop function if exists app_private.preview_view_ok(uuid, text);
drop function if exists public.free_uses(uuid);
drop function if exists public.billing_upsert_subscription(text, uuid, text, text, text, text, timestamptz, boolean, text, text);

drop table if exists public.funnel_events;
drop table if exists public.feedback_followups;
drop table if exists public.feedback;
drop table if exists public.previews;

-- Previous definitions (from 20261119180000_billing.sql).
create or replace function app_private.entitlement(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan text;
begin
  select s.plan_id into v_plan from public.subscriptions s
  where s.organization_id = p_org and s.status in ('active', 'trialing')
  order by case s.plan_id when 'scale_automation' then 1 when 'growth_ai' then 2 else 3 end limit 1;
  if v_plan is null and exists (
    select 1 from public.purchases p where p.organization_id = p_org and p.plan_id = 'diagnostic_audit'
      and not exists (select 1 from public.analyses a where a.organization_id = p_org
                      and a.status in ('complete', 'running') and a.started_at >= p.paid_at)
  ) then
    v_plan := 'diagnostic_audit';
  end if;
  if v_plan is null then
    return jsonb_build_object('plan', null, 'analyses', false, 'weekly', false, 'drafts', 'none');
  end if;
  return (select jsonb_build_object('plan', e.plan_id, 'analyses', e.analyses, 'weekly', e.weekly, 'drafts', e.drafts)
          from public.plan_entitlements e where e.plan_id = v_plan);
end $$;

create or replace function public.start_analysis(p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_website text;
begin
  if not app_private.can_act_for(p_org) or ((select auth.uid()) is null and not app_private.is_service()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = p_org for update;
  if not coalesce((app_private.entitlement(p_org) ->> (case when app_private.is_service() then 'weekly' else 'analyses' end))::boolean, false) then
    raise exception 'A plan is needed to run an analysis' using errcode = 'P0001', hint = 'needs_plan';
  end if;
  update public.analyses set status = 'failed', failure_reason = 'Timed out', completed_at = now()
  where organization_id = p_org and status = 'running' and started_at < now() - interval '15 minutes';
  if exists (select 1 from public.analyses where organization_id = p_org and status = 'running') then
    raise exception 'An analysis is already running' using errcode = 'P0001', hint = 'already_running';
  end if;
  if (select count(*) from public.analyses
      where organization_id = p_org and started_at > now() - interval '1 day') >= 10 then
    raise exception 'Daily analysis limit reached' using errcode = 'P0001', hint = 'daily_limit';
  end if;
  select website into v_website from public.business_profiles where organization_id = p_org;
  if v_website is null then
    raise exception 'Add a website first' using errcode = 'P0001', hint = 'no_website';
  end if;
  insert into public.analyses (organization_id, website, triggered_by)
  values (p_org, v_website, (select auth.uid())) returning id into v_id;
  perform app_private.log_activity(p_org, 'analysis.started', 'analysis', v_id::text,
    case when app_private.is_service() then '{"scheduled": true}'::jsonb else '{}'::jsonb end);
  return v_id;
end $$;

create or replace function public.start_agent_run(p_card uuid, p_instructions text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_card record;
  v_id uuid;
  v_drafts text;
begin
  select id, organization_id, status, ai_capable, execution_type into v_card
  from public.action_cards where id = p_card for update;
  if v_card.id is null or not app_private.is_org_member(v_card.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  v_drafts := app_private.entitlement(v_card.organization_id) ->> 'drafts';
  if v_drafts = 'none' or (v_drafts = 'meta' and v_card.execution_type <> 'meta') then
    raise exception 'Your plan does not include this draft' using errcode = 'P0001', hint = 'needs_plan';
  end if;
  if not v_card.ai_capable or v_card.execution_type = 'manual' then
    raise exception 'This action cannot be prepared by AI' using errcode = 'P0001', hint = 'not_ai_capable';
  end if;
  if v_card.status not in ('new', 'in_progress') then
    raise exception 'This action is closed' using errcode = 'P0001', hint = 'card_closed';
  end if;
  update public.agent_runs set status = 'failed', error = 'Timed out', completed_at = now()
  where action_card_id = p_card and status = 'running' and started_at < now() - interval '10 minutes';
  if exists (select 1 from public.agent_runs where action_card_id = p_card and status = 'running') then
    raise exception 'A draft is already being prepared' using errcode = 'P0001', hint = 'already_running';
  end if;
  if exists (select 1 from public.approvals where action_card_id = p_card and decision = 'pending') then
    raise exception 'A draft is waiting for approval' using errcode = 'P0001', hint = 'pending_approval';
  end if;
  if (select count(*) from public.agent_runs
      where organization_id = v_card.organization_id and started_at > now() - interval '1 day') >= 20 then
    raise exception 'Daily draft limit reached' using errcode = 'P0001', hint = 'daily_limit';
  end if;
  insert into public.agent_runs (organization_id, action_card_id, draft_type, instructions, started_by)
  values (v_card.organization_id, p_card, v_card.execution_type,
          nullif(left(btrim(coalesce(p_instructions, '')), 1000), ''), (select auth.uid()))
  returning id into v_id;
  update public.action_cards set status = 'in_progress' where id = p_card and status = 'new';
  perform app_private.log_activity(v_card.organization_id, 'agent_run.started', 'agent_run', v_id::text,
    jsonb_build_object('draft_type', v_card.execution_type, 'action_card_id', p_card));
  return v_id;
end $$;

drop function if exists app_private.free_uses_used(uuid, uuid);
drop function if exists app_private.site_key_ok(text);
drop function if exists app_private.config_int(text, int);
drop table if exists public.app_config;
delete from app_private.secrets where name = 'site_server';

alter table public.subscriptions drop column if exists billing_interval, drop column if exists stripe_price_id;
alter table public.agent_runs drop column if exists free_use;
alter table public.analyses drop column if exists free_use;
alter table public.business_profiles drop column if exists zip_code;

delete from public.plan_entitlements where plan_id in ('marketing_plan', 'single_site', 'business_plus', 'multi_site');
alter table public.plan_entitlements drop column if exists one_time;
alter table public.plan_entitlements drop constraint plan_entitlements_plan_id_check;
alter table public.plan_entitlements add constraint plan_entitlements_plan_id_check
  check (plan_id in ('diagnostic_audit', 'starter_ai', 'growth_ai', 'scale_automation'));

commit;
