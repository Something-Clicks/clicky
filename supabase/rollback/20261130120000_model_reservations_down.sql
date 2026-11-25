-- Rollback for 20261130120000_model_reservations.sql. Run by hand only, newest first (before the 20261129 rollback).
-- Data removed: reservations that were never settled (outcome 'reserved'); settled usage is kept.
-- record_model_usage, model_budget and admin_model_usage are restored to their 20261129 bodies.
begin;

drop function if exists public.settle_model_call(text, uuid, text, integer, integer, bigint, text);
drop function if exists public.reserve_model_call(text, uuid, text, text, text, bigint, uuid, uuid);
delete from public.model_usage where outcome = 'reserved';
alter table public.model_usage drop constraint model_usage_outcome_check;
alter table public.model_usage add constraint model_usage_outcome_check check (outcome in ('ok', 'refused', 'error'));
delete from app_private.secrets where name = 'model_usage';
drop function if exists app_private.model_usage_key_ok(text);

-- Whether a business may make another model call, and why not.
create or replace function public.model_budget(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_daily bigint;
  v_monthly bigint;
  v_global bigint := app_private.config_bigint('model_global_daily_cap_micro', 20000000);
  v_default_daily bigint := app_private.config_bigint('model_daily_cap_micro', 500000);
  v_spent_day bigint;
  v_spent_month bigint;
  v_global_day bigint;
begin
  if not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select coalesce(l.daily_cap_micro, app_private.config_bigint('model_daily_cap_micro', 500000)),
         coalesce(l.monthly_cap_micro, app_private.config_bigint('model_monthly_cap_micro', 5000000))
    into v_daily, v_monthly
  from (select 1) d left join public.organization_model_limits l on l.organization_id = p_org;
  select coalesce(sum(cost_micro), 0) into v_spent_day from public.model_usage
    where organization_id = p_org and created_at > now() - interval '1 day';
  select coalesce(sum(cost_micro), 0) into v_spent_month from public.model_usage
    where organization_id = p_org and created_at >= date_trunc('month', now());
  -- Each business counts toward the global total at most up to its own daily cap, so one account that records
  -- inflated usage can only spend its own allowance, not everyone's.
  select coalesce(sum(least(s.spent, coalesce(l.daily_cap_micro, v_default_daily))), 0) into v_global_day
  from (select organization_id, sum(cost_micro) as spent from public.model_usage where created_at > now() - interval '1 day' group by organization_id) s
  left join public.organization_model_limits l on l.organization_id = s.organization_id;
  return jsonb_build_object(
    'allowed', v_spent_day < v_daily and v_spent_month < v_monthly and v_global_day < v_global,
    'reason', case when v_global_day >= v_global then 'global_daily' when v_spent_day >= v_daily then 'daily'
                   when v_spent_month >= v_monthly then 'monthly' end,
    'spent_today_micro', v_spent_day, 'daily_cap_micro', v_daily,
    'spent_month_micro', v_spent_month, 'monthly_cap_micro', v_monthly);
end $$;

-- Platform admins: spend per business over the last p_days days.
create or replace function public.admin_model_usage(p_days integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not app_private.is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform app_private.log_activity(null, 'admin.model_usage_viewed', null, null, '{}'::jsonb);
  select coalesce(jsonb_agg(row_to_json(r) order by r.cost_micro desc), '[]'::jsonb) into v from (
    select o.name as organization, u.organization_id, count(*) as calls, sum(u.input_tokens) as input_tokens,
           sum(u.output_tokens) as output_tokens, sum(u.cost_micro) as cost_micro,
           count(*) filter (where u.outcome <> 'ok') as failed_calls
    from public.model_usage u join public.organizations o on o.id = u.organization_id
    where u.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)))
    group by o.name, u.organization_id) r;
  return v;
end $$;

-- Records one model call. Cost is computed by the app from the provider's published prices.
create or replace function public.record_model_usage(
  p_org uuid, p_capability text, p_provider text, p_model text, p_input integer, p_output integer,
  p_cost_micro bigint, p_outcome text, p_workflow uuid, p_agent_run uuid
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_workflow is not null and not exists (select 1 from public.marketing_workflows where id = p_workflow and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_agent_run is not null and not exists (select 1 from public.agent_runs where id = p_agent_run and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into public.model_usage (organization_id, capability, provider, model, input_tokens, output_tokens, cost_micro, outcome, workflow_id, agent_run_id)
  values (p_org, p_capability, p_provider, p_model, p_input, p_output, p_cost_micro, p_outcome, p_workflow, p_agent_run);
end $$;

revoke all on function public.record_model_usage(uuid, text, text, text, integer, integer, bigint, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_model_usage(uuid, text, text, text, integer, integer, bigint, text, uuid, uuid) to authenticated, service_role;

commit;
