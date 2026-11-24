-- Marketing agent foundation: workflow records and Prepared / Approved / Completed stages.
--
-- Additive only. Rollback: supabase/rollback/20261126120000_marketing_workflow_down.sql.
-- Nothing existing is renamed, rewritten or dropped; no existing function is replaced.
--
-- 1. action_cards gets three columns:
--    * origin           where the card came from. Every card today is 'website_check' (fixed,
--                       evidence-based checks). 'model' is reserved for future model-generated work,
--                       so it can always be told apart from verified checks.
--    * stage            GENERATED from status + verification (always consistent, nothing to maintain):
--                         prepared  - researched and prepared, waiting for the owner
--                         approved  - the owner approved it (not yet done)
--                         completed - the team recorded it done, or a later check verified it fixed
--                         dismissed - the owner chose not to do it
--                       A draft or recommendation is never 'completed' by being generated: only
--                       status 'done' (set by a person) or verification 'fixed' (set by a re-check) count.
--    * completion_basis GENERATED: 'verified' (a later check no longer finds it) or 'reported'
--                       (marked done by the team, not yet verified). Null unless completed.
-- 2. marketing_workflows: one record per orchestrator execution (what was asked, which
--    capabilities, the plan and step log, the result, model/usage when a model is used, errors).
--    Members read their own organization's rows; writes only through the functions below.
-- 3. Functions: start_marketing_workflow, finish_marketing_workflow, approve_action_card (owner only).

-- ── 1. action card stages ───────────────────────────────────────────────────
alter table public.action_cards
  add column origin text not null default 'website_check' check (origin in ('website_check', 'model')),
  add column stage text generated always as (
    case
      when status = 'dismissed' then 'dismissed'
      when status = 'done' then 'completed'
      when status = 'approved' and verification = 'fixed' then 'completed'
      when status = 'approved' then 'approved'
      else 'prepared'
    end) stored,
  add column completion_basis text generated always as (
    case
      when status in ('done', 'approved') and verification = 'fixed' then 'verified'
      when status = 'done' then 'reported'
    end) stored;
create index action_cards_stage_idx on public.action_cards (organization_id, stage);

-- ── 2. workflow records ─────────────────────────────────────────────────────
create table public.marketing_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in (
    'website_review', 'homepage_headline', 'competitor_research', 'marketing_plan',
    'promotional_campaign', 'results_review')),
  -- running → prepared (work ready for the owner) | blocked (a required capability is unavailable,
  -- e.g. no model provider) | failed (an error; reason in error)
  status text not null default 'running' check (status in ('running', 'prepared', 'blocked', 'failed')),
  request text check (request is null or length(request) <= 1000),
  capabilities text[] not null default '{}' check (cardinality(capabilities) <= 12),
  analysis_id uuid references public.analyses (id) on delete set null,
  -- [{ "step", "capability", "status", "detail", "at" }]
  steps jsonb not null default '[]'::jsonb,
  result jsonb,
  -- Null unless a model was actually called.
  provider text check (provider is null or length(provider) <= 50),
  model text check (model is null or length(model) <= 100),
  usage jsonb,
  error text check (error is null or length(error) <= 500),
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index marketing_workflows_org_idx on public.marketing_workflows (organization_id, started_at desc);
create index marketing_workflows_analysis_idx on public.marketing_workflows (analysis_id);
create index marketing_workflows_started_by_idx on public.marketing_workflows (started_by);
-- No duplicate execution: one running workflow of each kind per organization.
create unique index marketing_workflows_one_running_idx on public.marketing_workflows (organization_id, kind)
  where status = 'running';

revoke all on public.marketing_workflows from anon, authenticated;
grant select on public.marketing_workflows to authenticated;
alter table public.marketing_workflows enable row level security;
create policy "Members read marketing workflows" on public.marketing_workflows for select to authenticated
  using (app_private.is_org_member(organization_id));

-- ── 3. functions ────────────────────────────────────────────────────────────

-- Starts a workflow record for an organization the caller belongs to (or the server worker).
-- A run older than 15 minutes counts as abandoned. At most 50 per organization per day.
create function public.start_marketing_workflow(
  p_org uuid, p_kind text, p_request text, p_capabilities text[], p_analysis uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_analysis is not null and not exists (
    select 1 from public.analyses where id = p_analysis and organization_id = p_org
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = p_org for update;

  update public.marketing_workflows
  set status = 'failed', error = 'Timed out', completed_at = now()
  where organization_id = p_org and status = 'running' and started_at < now() - interval '15 minutes';

  if exists (select 1 from public.marketing_workflows
             where organization_id = p_org and kind = p_kind and status = 'running') then
    raise exception 'This work is already being prepared' using errcode = 'P0001', hint = 'already_running';
  end if;
  if (select count(*) from public.marketing_workflows
      where organization_id = p_org and started_at > now() - interval '1 day') >= 50 then
    raise exception 'Daily workflow limit reached' using errcode = 'P0001', hint = 'daily_limit';
  end if;

  insert into public.marketing_workflows (organization_id, kind, request, capabilities, analysis_id, started_by)
  values (p_org, p_kind, nullif(left(btrim(coalesce(p_request, '')), 1000), ''),
          coalesce(p_capabilities, '{}'), p_analysis, (select auth.uid()))
  returning id into v_id;
  perform app_private.log_activity(p_org, 'workflow.started', 'marketing_workflow', v_id::text,
    jsonb_build_object('kind', p_kind));
  return v_id;
end $$;

-- Records how a running workflow ended. Steps and result are validated for shape and size.
create function public.finish_marketing_workflow(
  p_workflow uuid, p_status text, p_steps jsonb, p_result jsonb, p_error text,
  p_provider text, p_model text, p_usage jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_wf record;
begin
  select id, organization_id, status into v_wf from public.marketing_workflows where id = p_workflow for update;
  if v_wf.id is null or not app_private.can_act_for(v_wf.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if v_wf.status <> 'running' then
    raise exception 'Workflow is not running' using errcode = 'P0001', hint = 'not_running';
  end if;
  if p_status not in ('prepared', 'blocked', 'failed') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_steps, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_steps, '[]'::jsonb)) > 30
     or (p_result is not null and (jsonb_typeof(p_result) <> 'object' or length(p_result::text) > 50000)) then
    raise exception 'Invalid workflow payload' using errcode = '22023';
  end if;
  if p_status = 'prepared' and p_result is null then
    raise exception 'A prepared workflow needs a result' using errcode = '22023';
  end if;

  update public.marketing_workflows
  set status = p_status, steps = coalesce(p_steps, '[]'::jsonb), result = p_result,
      error = left(p_error, 500), provider = left(p_provider, 50), model = left(p_model, 100),
      usage = p_usage, completed_at = now()
  where id = p_workflow;
  perform app_private.log_activity(v_wf.organization_id, 'workflow.' || p_status, 'marketing_workflow',
    p_workflow::text, '{}'::jsonb);
end $$;

-- The owner approves a prepared recommendation (no draft involved). Only owners may approve.
-- Approval is not completion: the card moves to 'approved' and is completed only when the team
-- marks it done or a later check verifies it fixed.
create function public.approve_action_card(p_card uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_card record;
begin
  select id, organization_id, status into v_card from public.action_cards where id = p_card for update;
  if v_card.id is null or not app_private.is_org_member(v_card.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not app_private.has_org_role(v_card.organization_id, 'owner') then
    raise exception 'Only the account owner can approve' using errcode = '42501', hint = 'owner_only';
  end if;
  if v_card.status = 'approved' then
    raise exception 'Already approved' using errcode = 'P0001', hint = 'already_approved';
  end if;
  if v_card.status <> 'new' then
    -- in_progress: a draft is being prepared or waits for its own approval (decide_approval).
    raise exception 'This action cannot be approved now' using errcode = 'P0001', hint = 'not_prepared';
  end if;

  update public.action_cards
  set status = 'approved',
      result_summary = coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
        'Approved. Make the change on your website, then mark it done.')
  where id = p_card;
  perform app_private.log_activity(v_card.organization_id, 'action_card.approved', 'action_card', p_card::text,
    '{}'::jsonb);
end $$;

revoke all on function public.start_marketing_workflow(uuid, text, text, text[], uuid),
  public.finish_marketing_workflow(uuid, text, jsonb, jsonb, text, text, text, jsonb),
  public.approve_action_card(uuid, text)
  from public, anon, authenticated;
grant execute on function public.start_marketing_workflow(uuid, text, text, text[], uuid),
  public.finish_marketing_workflow(uuid, text, jsonb, jsonb, text, text, text, jsonb)
  to authenticated, service_role;
grant execute on function public.approve_action_card(uuid, text) to authenticated;
