-- Something Clicks Marketing Agent: database-level off switch for the functions that store model-produced work.
--
-- add_model_findings, propose_business_facts, save_marketing_plan and complete_agent_run are called by the app
-- on behalf of the signed-in member, so (like every function the customer app calls) a member could also call
-- them directly. The feature switches that keep unfinished work hidden live in the app, so on their own they do not
-- stop a direct call. These four now also refuse unless app_config.agent_functions_enabled = 1, which the migration
-- sets to 0 and which is switched on only on development and Preview databases. Production stays closed even if
-- the app's switches were ever bypassed. (Before customers get any of this, the stronger protection is a
-- server-held key on these functions, like MODEL_USAGE_KEY; recorded in docs/agents/MARKETING_AGENT.md.)
-- Bodies are otherwise unchanged. Rollback: supabase/rollback/20261201120000_agent_functions_switch_down.sql.

insert into public.app_config (key, value, description) values
  ('agent_functions_enabled', '0', 'Set to 1 only on development and Preview databases: lets the app store model-produced findings, business details, plans and draft output.')
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

