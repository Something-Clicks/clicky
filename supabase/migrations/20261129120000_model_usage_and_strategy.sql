-- Something Clicks Marketing Agent: model usage and cost limits, deeper business understanding,
-- Marketing Strategy plans, and an admin review of agent output.
--
-- Additive, plus one replaced function (app_private.business_fact_field_ok gains three fields; the rollback
-- restores the original and removes facts that use the new fields first).
-- Rollback: supabase/rollback/20261129120000_model_usage_and_strategy_down.sql.
--
-- 1. model_usage: one row per model call (business, capability, provider, model, tokens, cost in
--    micro-dollars, outcome). model_budget() says whether a business may make another call:
--    per-business daily and monthly caps and a global daily cap (app_config; per-business overrides in
--    organization_model_limits, set by platform admins). The app checks it before every call.
-- 2. Business profile fields: brand.positioning, business.trust_signal, business.price_positioning.
-- 3. marketing_plans: Marketing Strategy's plan for a business (objectives, ordered priorities that point at
--    real Action Cards, next steps, questions for the owner). Proposed by the agent; only the owner approves.
--    Approval is agreement with the plan, not completion of any work.
-- 4. admin_agent_review(): platform admins review recent agent output across businesses (Preview quality review).

-- ── 1. model usage and cost limits ──────────────────────────────────────────
create table public.model_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  capability text not null check (capability ~ '^[a-z_.]{3,60}$'),
  provider text not null check (length(provider) between 1 and 50),
  model text not null check (length(model) between 1 and 100),
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_micro bigint not null check (cost_micro between 0 and 5000000),
  outcome text not null check (outcome in ('ok', 'refused', 'error')),
  workflow_id uuid references public.marketing_workflows (id) on delete set null,
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now()
);
create index model_usage_org_idx on public.model_usage (organization_id, created_at desc);
create index model_usage_created_idx on public.model_usage (created_at);
create index model_usage_workflow_idx on public.model_usage (workflow_id);
create index model_usage_agent_run_idx on public.model_usage (agent_run_id);

create table public.organization_model_limits (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  daily_cap_micro bigint check (daily_cap_micro is null or daily_cap_micro >= 0),
  monthly_cap_micro bigint check (monthly_cap_micro is null or monthly_cap_micro >= 0),
  note text check (note is null or length(note) <= 200),
  updated_at timestamptz not null default now()
);

revoke all on public.model_usage, public.organization_model_limits from anon, authenticated;
grant select on public.model_usage to authenticated;
alter table public.model_usage enable row level security;
alter table public.organization_model_limits enable row level security;
create policy "Members read their model usage" on public.model_usage for select to authenticated
  using (app_private.is_org_member(organization_id));

insert into public.app_config (key, value, description) values
  ('model_daily_cap_micro', '500000', 'Model spend per business per day, in millionths of a US dollar ($0.50).'),
  ('model_monthly_cap_micro', '5000000', 'Model spend per business per calendar month, in millionths of a US dollar ($5).'),
  ('model_global_daily_cap_micro', '20000000', 'Model spend across all businesses per day, in millionths of a US dollar ($20).')
on conflict (key) do nothing;

create function app_private.config_bigint(p_key text, p_default bigint) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::bigint from public.app_config where key = p_key), p_default);
$$;

-- Whether a business may make another model call, and why not.
create function public.model_budget(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_daily bigint;
  v_monthly bigint;
  v_global bigint := app_private.config_bigint('model_global_daily_cap_micro', 20000000);
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
  select coalesce(sum(cost_micro), 0) into v_global_day from public.model_usage where created_at > now() - interval '1 day';
  return jsonb_build_object(
    'allowed', v_spent_day < v_daily and v_spent_month < v_monthly and v_global_day < v_global,
    'reason', case when v_global_day >= v_global then 'global_daily' when v_spent_day >= v_daily then 'daily'
                   when v_spent_month >= v_monthly then 'monthly' end,
    'spent_today_micro', v_spent_day, 'daily_cap_micro', v_daily,
    'spent_month_micro', v_spent_month, 'monthly_cap_micro', v_monthly);
end $$;

-- Records one model call. Cost is computed by the app from the provider's published prices.
create function public.record_model_usage(
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

-- Platform admins: spend per business over the last p_days days.
create function public.admin_model_usage(p_days integer) returns jsonb
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

-- ── 2. more profile fields ──────────────────────────────────────────────────
create or replace function app_private.business_fact_field_ok(p_category text, p_field text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_category
    when 'business' then p_field in ('what_it_does', 'industry', 'business_model', 'service', 'product', 'service_area',
      'location', 'contact_phone', 'contact_email', 'pricing', 'competitive_advantage', 'goal', 'marketing_objective', 'constraint',
      'trust_signal', 'price_positioning')
    when 'brand' then p_field in ('voice', 'tone', 'value_proposition', 'key_message', 'preferred_term', 'avoid_term', 'brand_guideline',
      'positioning')
    when 'customer' then p_field in ('audience', 'customer_problem', 'motivation', 'objection', 'customer_question', 'decision_factor')
    else false
  end;
$$;

-- ── 3. marketing plans ──────────────────────────────────────────────────────
create table public.marketing_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  analysis_id uuid references public.analyses (id) on delete set null,
  -- { summary, objectives[], priorities[{card_id, order, why_now, effort, depends_on[]}], next_steps[], questions[], not_now[] }
  plan jsonb not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'superseded')),
  provider text check (provider is null or length(provider) <= 50),
  model text check (model is null or length(model) <= 100),
  created_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint marketing_plans_shape check (
    jsonb_typeof(plan) = 'object' and jsonb_typeof(plan -> 'priorities') = 'array'
    and jsonb_array_length(plan -> 'priorities') between 1 and 10 and length(plan::text) <= 40000)
);
create index marketing_plans_org_idx on public.marketing_plans (organization_id, created_at desc);
create index marketing_plans_analysis_idx on public.marketing_plans (analysis_id);
create index marketing_plans_created_by_idx on public.marketing_plans (created_by);
create index marketing_plans_decided_by_idx on public.marketing_plans (decided_by);

revoke all on public.marketing_plans from anon, authenticated;
grant select on public.marketing_plans to authenticated;
alter table public.marketing_plans enable row level security;
create policy "Members read marketing plans" on public.marketing_plans for select to authenticated
  using (app_private.is_org_member(organization_id));

-- Saves a proposed plan. Every priority must point at an open Action Card of this business.
-- Earlier proposed plans are superseded.
create function public.save_marketing_plan(p_org uuid, p_analysis uuid, p_plan jsonb, p_provider text, p_model text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_dep text;
  v_id uuid;
begin
  if not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_analysis is not null and not exists (select 1 from public.analyses where id = p_analysis and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_plan -> 'priorities') <> 'array' or jsonb_array_length(p_plan -> 'priorities') not between 1 and 10 then
    raise exception 'A plan needs 1 to 10 priorities' using errcode = '22023';
  end if;
  for v_item in select * from jsonb_array_elements(p_plan -> 'priorities') loop
    if not exists (
      select 1 from public.action_cards
      where id::text = v_item ->> 'card_id' and organization_id = p_org and status in ('new', 'approved', 'in_progress')
    ) then
      raise exception 'A priority must point at an open action of this business' using errcode = '22023', hint = 'unknown_card';
    end if;
    for v_dep in select jsonb_array_elements_text(coalesce(v_item -> 'depends_on', '[]'::jsonb)) loop
      if v_dep = v_item ->> 'card_id' or not exists (
        select 1 from jsonb_array_elements(p_plan -> 'priorities') o where o ->> 'card_id' = v_dep
      ) then
        raise exception 'A dependency must be another priority in the plan' using errcode = '22023';
      end if;
    end loop;
  end loop;
  update public.marketing_plans set status = 'superseded' where organization_id = p_org and status = 'proposed';
  insert into public.marketing_plans (organization_id, analysis_id, plan, provider, model, created_by)
  values (p_org, p_analysis, p_plan, left(p_provider, 50), left(p_model, 100), (select auth.uid()))
  returning id into v_id;
  perform app_private.log_activity(p_org, 'plan.proposed', 'marketing_plan', v_id::text,
    jsonb_build_object('priorities', jsonb_array_length(p_plan -> 'priorities')));
  return v_id;
end $$;

-- The owner approves or rejects a proposed plan.
create function public.decide_marketing_plan(p_plan uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_plan record;
begin
  select id, organization_id, status into v_plan from public.marketing_plans where id = p_plan for update;
  if v_plan.id is null or not app_private.is_org_member(v_plan.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not app_private.has_org_role(v_plan.organization_id, 'owner') then
    raise exception 'Only the account owner can approve a plan' using errcode = '42501', hint = 'owner_only';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if v_plan.status <> 'proposed' then
    raise exception 'This plan was already decided' using errcode = 'P0001', hint = 'already_decided';
  end if;
  if p_decision = 'approved' then
    update public.marketing_plans set status = 'superseded' where organization_id = v_plan.organization_id and status = 'approved';
  end if;
  update public.marketing_plans set status = p_decision, decided_by = (select auth.uid()), decided_at = now() where id = p_plan;
  perform app_private.log_activity(v_plan.organization_id, 'plan.' || p_decision, 'marketing_plan', p_plan::text, '{}'::jsonb);
end $$;

-- ── 4. admin review of agent output ─────────────────────────────────────────
create function public.admin_agent_review(p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not app_private.is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform app_private.log_activity(null, 'admin.agent_review_viewed', null, null, '{}'::jsonb);
  select coalesce(jsonb_agg(row_to_json(r) order by r.started_at desc), '[]'::jsonb) into v from (
    select w.id, w.organization_id, o.name as organization, b.website, w.kind, w.status, w.started_at, w.completed_at,
           w.provider, w.model, w.usage, w.steps, w.result -> 'evidence_classes' as evidence_classes, w.error,
           (select coalesce(jsonb_agg(jsonb_build_object('category', f.category, 'field', f.field, 'value', f.value,
                   'source', f.source, 'evidence_class', f.evidence_class, 'basis', f.basis, 'evidence', f.evidence, 'status', f.status)), '[]'::jsonb)
              from public.business_facts f where f.analysis_id = w.analysis_id) as facts,
           (select coalesce(jsonb_agg(jsonb_build_object('title', c.title, 'explanation', c.explanation, 'why_it_matters', c.why_it_matters,
                   'recommended_action', c.recommended_action, 'impact', c.impact_priority, 'confidence', c.confidence,
                   'evidence_class', c.evidence_class, 'evidence_basis', c.evidence_basis, 'origin', c.origin,
                   'evidence', (select coalesce(jsonb_agg(e.excerpt), '[]'::jsonb) from public.action_card_evidence ace
                                 join public.analysis_evidence e on e.id = ace.evidence_id where ace.action_card_id = c.id))), '[]'::jsonb)
              from public.action_cards c where c.analysis_id = w.analysis_id) as findings,
           (select p.plan from public.marketing_plans p where p.analysis_id = w.analysis_id order by p.created_at desc limit 1) as plan
    from public.marketing_workflows w
    join public.organizations o on o.id = w.organization_id
    left join public.business_profiles b on b.organization_id = w.organization_id
    order by w.started_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50))) r;
  return v;
end $$;

revoke all on function public.model_budget(uuid), public.record_model_usage(uuid, text, text, text, integer, integer, bigint, text, uuid, uuid),
  public.admin_model_usage(integer), public.save_marketing_plan(uuid, uuid, jsonb, text, text),
  public.decide_marketing_plan(uuid, text), public.admin_agent_review(integer), app_private.config_bigint(text, bigint)
  from public, anon, authenticated;
grant execute on function public.model_budget(uuid), public.record_model_usage(uuid, text, text, text, integer, integer, bigint, text, uuid, uuid),
  public.save_marketing_plan(uuid, uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.admin_model_usage(integer), public.decide_marketing_plan(uuid, text), public.admin_agent_review(integer) to authenticated;
