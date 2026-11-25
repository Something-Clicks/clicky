-- Something Clicks Marketing Agent: server-held authorization and admission limits for model work.
--
-- 1. The four functions that store model-produced work (add_model_findings, propose_business_facts, save_marketing_plan,
--    complete_agent_run) now also require the app server's key, sent as the request header x-agent-key and checked against the
--    same hashed secret as reserve/settle (app_private.secrets 'model_usage'). A signed-in customer calling them straight
--    through the API has no key and is refused (hint 'agent_key'), on top of the database off-switch from 20261201.
-- 2. Admission limits in reserve_model_call: at most model_org_hourly_calls (30) model calls per business per hour, and at most
--    model_user_daily_cap_micro ($1) of model spend per person per day across every business they act for, so creating many
--    businesses (or accounts' worth of them) no longer multiplies the allowance. model_usage records who asked (requested_by).
-- 3. agent slots: acquire_agent_slot / release_agent_slot, an atomic "one at a time" lock per business and kind of work with an
--    expiry, held for the whole request (used for plans), so repeated submissions cannot start a second model run.
-- Bodies of the four functions are otherwise unchanged. Rollback: supabase/rollback/20261202120000_agent_admission_down.sql.

create function app_private.agent_key_ok() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_headers text := current_setting('request.headers', true);
  v_key text;
begin
  if v_headers is null or v_headers = '' then
    return false;
  end if;
  begin
    v_key := v_headers::json ->> 'x-agent-key';
  exception when others then
    return false;
  end;
  return app_private.model_usage_key_ok(v_key);
end $$;
revoke all on function app_private.agent_key_ok() from public, anon, authenticated;

alter table public.model_usage add column requested_by uuid references auth.users (id) on delete set null;
create index model_usage_requested_by_idx on public.model_usage (requested_by, created_at);

insert into public.app_config (key, value, description) values
  ('model_org_hourly_calls', '30', 'Most model calls a business can start per hour.'),
  ('model_user_daily_cap_micro', '1000000', 'Model spend per person per day across all their businesses, in millionths of a US dollar ($1).')
on conflict (key) do nothing;

create or replace function public.add_model_findings(p_analysis uuid, p_evidence jsonb, p_cards jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_an record;
  v_ev jsonb;
  v_card jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_ev_id uuid;
  v_card_id uuid;
  v_key text;
  v_added integer := 0;
begin
  -- Model-produced work is stored only where this database is switched on for it (never Production).
  if app_private.config_bigint('agent_functions_enabled', 0) <> 1 then
    raise exception 'Not available yet' using errcode = '42501', hint = 'disabled';
  end if;
  -- Only the app's server holds the key (sent as a request header); a signed-in customer calling this directly does not.
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
  select id, organization_id, status, completed_at into v_an from public.analyses where id = p_analysis for update;
  if v_an.id is null or not app_private.can_act_for(v_an.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if v_an.status <> 'complete' or v_an.completed_at < now() - interval '1 hour' then
    raise exception 'Findings can only be added to an analysis that just finished' using errcode = 'P0001', hint = 'analysis_not_current';
  end if;
  if exists (select 1 from public.action_cards where analysis_id = p_analysis and origin = 'model') then
    raise exception 'Model findings were already added to this analysis' using errcode = 'P0001', hint = 'already_added';
  end if;
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_typeof(p_cards) <> 'array'
     or jsonb_array_length(p_evidence) > 40 or jsonb_array_length(p_cards) > 8 then
    raise exception 'Invalid findings payload' using errcode = '22023';
  end if;

  for v_ev in select * from jsonb_array_elements(p_evidence) loop
    insert into public.analysis_evidence (analysis_id, organization_id, source, kind, check_key, url, observation, excerpt)
    values (p_analysis, v_an.organization_id, 'website', 'observed', 'model.quote', v_ev ->> 'url',
            coalesce(nullif(v_ev ->> 'observation', ''), 'Quoted from the page.'), v_ev ->> 'excerpt')
    returning id into v_ev_id;
    v_keys := v_keys || jsonb_build_object(v_ev ->> 'key', v_ev_id);
  end loop;

  for v_card in select * from jsonb_array_elements(p_cards) loop
    if coalesce(v_card ->> 'check_key', '') !~ '^model\.[a-z0-9_]{1,60}$' then
      raise exception 'Model findings use model.* keys' using errcode = '22023';
    end if;
    if coalesce(v_card ->> 'evidence_class', '') not in ('verified', 'inferred', 'estimated') then
      raise exception 'A finding needs evidence: verified, inferred or estimated' using errcode = '23514';
    end if;
    insert into public.action_cards (
      organization_id, analysis_id, check_key, title, explanation, why_it_matters, recommended_action, expected_benefit,
      impact_priority, confidence, ai_capable, execution_type, approval_required, wording, origin, evidence_class, evidence_basis)
    values (
      v_an.organization_id, p_analysis, v_card ->> 'check_key', v_card ->> 'title', v_card ->> 'explanation',
      v_card ->> 'why_it_matters', v_card ->> 'recommended_action', v_card ->> 'expected_benefit',
      v_card ->> 'impact_priority', v_card ->> 'confidence', coalesce((v_card ->> 'ai_capable')::boolean, false),
      coalesce(v_card ->> 'execution_type', 'manual'), true, 'ai', 'model', v_card ->> 'evidence_class',
      nullif(btrim(coalesce(v_card ->> 'evidence_basis', '')), ''))
    returning id into v_card_id;
    for v_key in select jsonb_array_elements_text(coalesce(v_card -> 'evidence_keys', '[]'::jsonb)) loop
      if not v_keys ? v_key then
        raise exception 'A finding cites evidence that was not supplied' using errcode = '22023';
      end if;
      insert into public.action_card_evidence (action_card_id, evidence_id, organization_id)
      values (v_card_id, (v_keys ->> v_key)::uuid, v_an.organization_id) on conflict do nothing;
    end loop;
    v_added := v_added + 1;
  end loop;

  -- Internal record (workflow.* entries are not shown in the customer's history).
  perform app_private.log_activity(v_an.organization_id, 'workflow.model_findings', 'analysis', p_analysis::text,
    jsonb_build_object('cards', v_added));
  return v_added;
end $$;

create or replace function public.propose_business_facts(p_org uuid, p_analysis uuid, p_facts jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_fact jsonb;
  v_added integer := 0;
  v_existing_id uuid;
  v_existing_status text;
begin
  -- Model-produced work is stored only where this database is switched on for it (never Production).
  if app_private.config_bigint('agent_functions_enabled', 0) <> 1 then
    raise exception 'Not available yet' using errcode = '42501', hint = 'disabled';
  end if;
  -- Only the app's server holds the key (sent as a request header); a signed-in customer calling this directly does not.
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
  if not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_analysis is not null and not exists (select 1 from public.analyses where id = p_analysis and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) > 50 then
    raise exception 'Invalid facts payload' using errcode = '22023';
  end if;

  for v_fact in select * from jsonb_array_elements(p_facts) loop
    if coalesce(v_fact ->> 'source', '') not in ('website', 'model', 'research') then
      raise exception 'Proposed facts come from the website, a model or research' using errcode = '22023';
    end if;
    if not app_private.business_fact_field_ok(v_fact ->> 'category', v_fact ->> 'field') then
      raise exception 'Unknown business detail %.%', v_fact ->> 'category', v_fact ->> 'field' using errcode = '23514', hint = 'business_facts_field_check';
    end if;
    v_existing_id := null;
    v_existing_status := null;
    select id, status into v_existing_id, v_existing_status from public.business_facts
    where organization_id = p_org and field = v_fact ->> 'field'
      and lower(coalesce(value, '')) = lower(coalesce(v_fact ->> 'value', ''))
      and status in ('proposed', 'confirmed', 'rejected')
    order by (status = 'rejected') desc
    limit 1;
    if v_existing_id is not null then
      if v_existing_status <> 'rejected' then
        update public.business_facts set observed_at = now(), analysis_id = coalesce(p_analysis, analysis_id)
        where id = v_existing_id;
      end if;
      continue;
    end if;
    insert into public.business_facts (organization_id, category, field, value, source, evidence_class, basis, evidence, analysis_id)
    values (p_org, v_fact ->> 'category', v_fact ->> 'field', nullif(btrim(v_fact ->> 'value'), ''), v_fact ->> 'source',
            v_fact ->> 'evidence_class', nullif(btrim(coalesce(v_fact ->> 'basis', '')), ''),
            coalesce(v_fact -> 'evidence', '[]'::jsonb), p_analysis);
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then
    perform app_private.log_activity(p_org, 'business_fact.proposed', 'organization', p_org::text,
      jsonb_build_object('added', v_added, 'analysis_id', p_analysis));
  end if;
  return v_added;
end $$;

create or replace function public.save_marketing_plan(p_org uuid, p_analysis uuid, p_plan jsonb, p_provider text, p_model text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_dep text;
  v_id uuid;
begin
  -- Model-produced work is stored only where this database is switched on for it (never Production).
  if app_private.config_bigint('agent_functions_enabled', 0) <> 1 then
    raise exception 'Not available yet' using errcode = '42501', hint = 'disabled';
  end if;
  -- Only the app's server holds the key (sent as a request header); a signed-in customer calling this directly does not.
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
  if not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_analysis is not null and not exists (select 1 from public.analyses where id = p_analysis and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_plan -> 'priorities') is distinct from 'array' or jsonb_array_length(p_plan -> 'priorities') not between 1 and 10 then
    raise exception 'A plan needs 1 to 10 priorities' using errcode = '22023';
  end if;
  -- Full shape: the app reads every part, so every part must be present and of the right type and size.
  if jsonb_typeof(p_plan -> 'summary') is distinct from 'string' or length(p_plan ->> 'summary') not between 1 and 600
     or jsonb_typeof(p_plan -> 'objectives') is distinct from 'array' or jsonb_array_length(p_plan -> 'objectives') > 3
     or jsonb_typeof(p_plan -> 'next_steps') is distinct from 'array' or jsonb_array_length(p_plan -> 'next_steps') > 5
     or jsonb_typeof(p_plan -> 'questions') is distinct from 'array' or jsonb_array_length(p_plan -> 'questions') > 4
     or jsonb_typeof(p_plan -> 'not_now') is distinct from 'array' or jsonb_array_length(p_plan -> 'not_now') > 5
     or exists (select 1 from jsonb_array_elements(p_plan -> 'objectives') o
                where jsonb_typeof(o) is distinct from 'object' or jsonb_typeof(o -> 'objective') is distinct from 'string' or length(o ->> 'objective') > 300)
     or exists (select 1 from jsonb_array_elements(p_plan -> 'next_steps') n where jsonb_typeof(n) is distinct from 'string' or length(n #>> '{}') > 300)
     or exists (select 1 from jsonb_array_elements(p_plan -> 'questions') n where jsonb_typeof(n) is distinct from 'string' or length(n #>> '{}') > 300)
     or exists (select 1 from jsonb_array_elements(p_plan -> 'not_now') n
                where jsonb_typeof(n) is distinct from 'object' or jsonb_typeof(n -> 'reason') is distinct from 'string' or length(n ->> 'reason') > 300
                   or not exists (select 1 from public.action_cards c where c.id::text = n ->> 'card_id' and c.organization_id = p_org)) then
    raise exception 'The plan is not in the expected shape' using errcode = '22023', hint = 'invalid_plan';
  end if;
  for v_item in select * from jsonb_array_elements(p_plan -> 'priorities') loop
    if jsonb_typeof(v_item -> 'why_now') is distinct from 'string' or length(v_item ->> 'why_now') not between 1 and 500
       or (v_item ->> 'effort') is null or (v_item ->> 'effort') not in ('small', 'medium', 'large')
       or jsonb_typeof(v_item -> 'order') is distinct from 'number'
       or jsonb_typeof(coalesce(v_item -> 'based_on', '[]'::jsonb)) is distinct from 'array'
       or jsonb_typeof(coalesce(v_item -> 'depends_on', '[]'::jsonb)) is distinct from 'array' then
      raise exception 'The plan is not in the expected shape' using errcode = '22023', hint = 'invalid_plan';
    end if;
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

create or replace function public.complete_agent_run(p_run uuid, p_output jsonb, p_model text, p_usage jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_run record;
  v_approval uuid;
  v_field jsonb;
begin
  -- Model-produced work is stored only where this database is switched on for it (never Production).
  if app_private.config_bigint('agent_functions_enabled', 0) <> 1 then
    raise exception 'Not available yet' using errcode = '42501', hint = 'disabled';
  end if;
  -- Only the app's server holds the key (sent as a request header); a signed-in customer calling this directly does not.
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
  select id, organization_id, action_card_id, status into v_run from public.agent_runs where id = p_run for update;
  if v_run.id is null or not app_private.is_org_member(v_run.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if v_run.status <> 'running' then
    raise exception 'Run is not running' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_output -> 'fields') <> 'array' or jsonb_array_length(p_output -> 'fields') not between 1 and 10 then
    raise exception 'Invalid draft' using errcode = '22023';
  end if;
  for v_field in select * from jsonb_array_elements(p_output -> 'fields') loop
    if coalesce(length(v_field ->> 'text'), 0) not between 1 and 8000
       or coalesce(length(v_field ->> 'label'), 0) not between 1 and 80 then
      raise exception 'Invalid draft field' using errcode = '22023';
    end if;
  end loop;

  update public.agent_runs
  set status = 'succeeded', output = p_output, model = left(p_model, 100), usage = p_usage, completed_at = now()
  where id = p_run;
  insert into public.approvals (organization_id, agent_run_id, action_card_id)
  values (v_run.organization_id, p_run, v_run.action_card_id) returning id into v_approval;
  perform app_private.log_activity(v_run.organization_id, 'agent_run.succeeded', 'agent_run', p_run::text,
    jsonb_build_object('approval_id', v_approval));
  return v_approval;
end $$;

create or replace function public.reserve_model_call(
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
  -- Admission limits (before the money caps): how often a business can start model calls, and how much one person can
  -- spend across all the businesses they act for, so many throwaway businesses by one person do not multiply the allowance.
  if (select count(*) from public.model_usage where organization_id = p_org and created_at > now() - interval '1 hour')
       >= app_private.config_bigint('model_org_hourly_calls', 30) then
    raise exception 'Too many model calls' using errcode = 'P0001', hint = 'hourly';
  end if;
  if (select coalesce(sum(cost_micro), 0) from public.model_usage where requested_by = (select auth.uid()) and created_at > now() - interval '1 day') + p_max_cost_micro
       > app_private.config_bigint('model_user_daily_cap_micro', 1000000) then
    raise exception 'Model budget reached' using errcode = 'P0001', hint = 'user_daily';
  end if;
  v_budget := app_private.model_budget_full(p_org);
  if (v_budget ->> 'global_spent_micro')::bigint + p_max_cost_micro > (v_budget ->> 'global_cap_micro')::bigint then
    raise exception 'Model budget reached' using errcode = 'P0001', hint = 'global_daily';
  end if;
  if (v_budget ->> 'spent_today_micro')::bigint + p_max_cost_micro > (v_budget ->> 'daily_cap_micro')::bigint then
    raise exception 'Model budget reached' using errcode = 'P0001', hint = 'daily';
  end if;
  if (v_budget ->> 'spent_month_micro')::bigint + p_max_cost_micro > (v_budget ->> 'monthly_cap_micro')::bigint then
    raise exception 'Model budget reached' using errcode = 'P0001', hint = 'monthly';
  end if;
  insert into public.model_usage (organization_id, capability, provider, model, input_tokens, output_tokens, cost_micro, outcome, workflow_id, agent_run_id, requested_by)
  values (p_org, p_capability, p_provider, p_model, 0, 0, p_max_cost_micro, 'reserved', p_workflow, p_agent_run, (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create table app_private.agent_slots (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (name ~ '^[a-z_.]{3,60}$'),
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz not null,
  primary key (organization_id, name)
);
revoke all on app_private.agent_slots from public, anon, authenticated;

-- Takes the slot for a business and kind of work, or refuses with hint 'busy' if someone holds it and it has not expired.
create function public.acquire_agent_slot(p_key text, p_org uuid, p_name text, p_seconds integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_token uuid;
begin
  if not app_private.model_usage_key_ok(p_key) or not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_name !~ '^[a-z_.]{3,60}$' or p_seconds is null or p_seconds not between 10 and 300 then
    raise exception 'Invalid slot' using errcode = '22023';
  end if;
  insert into app_private.agent_slots as s (organization_id, name, expires_at)
  values (p_org, p_name, now() + make_interval(secs => p_seconds))
  on conflict (organization_id, name) do update set token = gen_random_uuid(), expires_at = excluded.expires_at
    where s.expires_at <= now()
  returning token into v_token;
  if v_token is null then
    raise exception 'Already running' using errcode = 'P0001', hint = 'busy';
  end if;
  return v_token;
end $$;

create function public.release_agent_slot(p_key text, p_org uuid, p_name text, p_token uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.model_usage_key_ok(p_key) or not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  delete from app_private.agent_slots where organization_id = p_org and name = p_name and token = p_token;
end $$;

revoke all on function public.acquire_agent_slot(text, uuid, text, integer), public.release_agent_slot(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.acquire_agent_slot(text, uuid, text, integer), public.release_agent_slot(text, uuid, text, uuid) to authenticated, service_role;
