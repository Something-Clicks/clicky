-- Something Clicks Marketing Agent: tamper-proof, race-free model cost control.
--
-- Resolves the two limits recorded after the independent security review of 20261129:
--  1. Forged usage: record_model_usage was callable by any signed-in member of a business. It is removed.
--     Usage is now written only through reserve_model_call / settle_model_call, which also require a
--     server-held key (MODEL_USAGE_KEY; only its SHA-256 hash is stored, in app_private.secrets, like the
--     billing and site keys). Customers never hold the key, so they cannot create, alter or inflate usage.
--  2. Parallel requests: the budget check and the usage record were separate steps. reserve_model_call now
--     checks the caps and records a reservation for the worst-case cost in one step, under a lock, so
--     parallel calls cannot together exceed a cap. settle_model_call replaces the reservation with the
--     actual tokens and cost. A call that never settles (the server died mid-call) stays counted at its
--     reserved cost, which errs on the side of spending less.
-- model_budget (read-only) now also reports the global figures. Additive plus replaced functions; rollback:
-- supabase/rollback/20261130120000_model_reservations_down.sql.

create function app_private.model_usage_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from app_private.secrets s where s.name = 'model_usage' and s.hash = sha256(convert_to(p_key, 'UTF8'))
  ), false);
$$;

alter table public.model_usage drop constraint model_usage_outcome_check;
alter table public.model_usage add constraint model_usage_outcome_check check (outcome in ('ok', 'refused', 'error', 'reserved'));

drop function public.record_model_usage(uuid, text, text, text, integer, integer, bigint, text, uuid, uuid);

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
  select coalesce(l.daily_cap_micro, v_default_daily),
         coalesce(l.monthly_cap_micro, app_private.config_bigint('model_monthly_cap_micro', 5000000))
    into v_daily, v_monthly
  from (select 1) d left join public.organization_model_limits l on l.organization_id = p_org;
  -- Reservations count as spent until they are settled.
  select coalesce(sum(cost_micro), 0) into v_spent_day from public.model_usage
    where organization_id = p_org and created_at > now() - interval '1 day';
  select coalesce(sum(cost_micro), 0) into v_spent_month from public.model_usage
    where organization_id = p_org and created_at >= date_trunc('month', now());
  -- Each business counts toward the global total at most up to its own daily cap.
  select coalesce(sum(least(s.spent, coalesce(l.daily_cap_micro, v_default_daily))), 0) into v_global_day
  from (select organization_id, sum(cost_micro) as spent from public.model_usage where created_at > now() - interval '1 day' group by organization_id) s
  left join public.organization_model_limits l on l.organization_id = s.organization_id;
  return jsonb_build_object(
    'allowed', v_spent_day < v_daily and v_spent_month < v_monthly and v_global_day < v_global,
    'reason', case when v_global_day >= v_global then 'global_daily' when v_spent_day >= v_daily then 'daily'
                   when v_spent_month >= v_monthly then 'monthly' end,
    'spent_today_micro', v_spent_day, 'daily_cap_micro', v_daily,
    'spent_month_micro', v_spent_month, 'monthly_cap_micro', v_monthly,
    'global_spent_micro', v_global_day, 'global_cap_micro', v_global);
end $$;

-- Checks the caps for the worst-case cost of one call and, if it fits, records the reservation. One step, one lock.
create function public.reserve_model_call(
  p_key text, p_org uuid, p_capability text, p_provider text, p_model text, p_max_cost_micro bigint, p_workflow uuid, p_agent_run uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_budget jsonb;
  v_id uuid;
begin
  if not app_private.model_usage_key_ok(p_key) or not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_max_cost_micro is null or p_max_cost_micro not between 0 and 5000000 then
    raise exception 'Invalid reservation' using errcode = '22023';
  end if;
  if p_workflow is not null and not exists (select 1 from public.marketing_workflows where id = p_workflow and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_agent_run is not null and not exists (select 1 from public.agent_runs where id = p_agent_run and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  -- Serialises every reservation (business and global caps are checked together), so parallel requests queue here.
  perform pg_advisory_xact_lock(hashtextextended('model_reservations', 0));
  v_budget := public.model_budget(p_org);
  if (v_budget ->> 'global_spent_micro')::bigint + p_max_cost_micro > (v_budget ->> 'global_cap_micro')::bigint then
    raise exception 'Model budget reached' using errcode = 'P0001', hint = 'global_daily';
  end if;
  if (v_budget ->> 'spent_today_micro')::bigint + p_max_cost_micro > (v_budget ->> 'daily_cap_micro')::bigint then
    raise exception 'Model budget reached' using errcode = 'P0001', hint = 'daily';
  end if;
  if (v_budget ->> 'spent_month_micro')::bigint + p_max_cost_micro > (v_budget ->> 'monthly_cap_micro')::bigint then
    raise exception 'Model budget reached' using errcode = 'P0001', hint = 'monthly';
  end if;
  insert into public.model_usage (organization_id, capability, provider, model, input_tokens, output_tokens, cost_micro, outcome, workflow_id, agent_run_id)
  values (p_org, p_capability, p_provider, p_model, 0, 0, p_max_cost_micro, 'reserved', p_workflow, p_agent_run)
  returning id into v_id;
  return v_id;
end $$;

-- Replaces a reservation with what the call actually used. Only the reservation's own business, only once.
create function public.settle_model_call(
  p_key text, p_reservation uuid, p_model text, p_input integer, p_output integer, p_cost_micro bigint, p_outcome text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  if not app_private.model_usage_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select organization_id into v_org from public.model_usage where id = p_reservation and outcome = 'reserved' for update;
  if v_org is null or not app_private.can_act_for(v_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_outcome not in ('ok', 'refused', 'error') or p_cost_micro is null or p_cost_micro not between 0 and 5000000 then
    raise exception 'Invalid settlement' using errcode = '22023';
  end if;
  update public.model_usage
     set model = left(p_model, 100), input_tokens = greatest(p_input, 0), output_tokens = greatest(p_output, 0), cost_micro = p_cost_micro, outcome = p_outcome
   where id = p_reservation;
end $$;

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
           count(*) filter (where u.outcome in ('refused', 'error')) as failed_calls,
           count(*) filter (where u.outcome = 'reserved') as unsettled_calls
    from public.model_usage u join public.organizations o on o.id = u.organization_id
    where u.created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)))
    group by o.name, u.organization_id) r;
  return v;
end $$;

revoke all on function public.reserve_model_call(text, uuid, text, text, text, bigint, uuid, uuid), public.settle_model_call(text, uuid, text, integer, integer, bigint, text),
  app_private.model_usage_key_ok(text) from public, anon, authenticated;
grant execute on function public.reserve_model_call(text, uuid, text, text, text, bigint, uuid, uuid), public.settle_model_call(text, uuid, text, integer, integer, bigint, text)
  to authenticated, service_role;
