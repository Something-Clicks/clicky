-- Marketing Agent memory and execution (specification §4.3, §10, §11, §13, §14).
-- Additive. Rollback: supabase/rollback/20261204120000_agent_memory_and_execution_down.sql
--
-- 1. research_items      Research Library: keyword research the owner supplies (a Semrush or Search Console export, or
--                        typed in). Every row keeps its source, the date the source measured it, an evidence class and,
--                        unless verified, the basis. Re-importing a term keeps the earlier figures for comparison.
-- 2. performance_metrics Performance History: only figures that were supplied (entered by the owner or from an export the
--                        owner uploaded), each for an explicit period with its source. Nothing is estimated or filled in.
-- 3. execution_records   Marketing Execution: what was requested, who authorized it, what was executed, when, whether it
--                        succeeded and whether a later website check verified it. Requesting, authorizing, executing and
--                        verifying are separate events. Only actions the application can actually perform run; publishing,
--                        sending and ad spend have no integration and are recorded as "unsupported", never executed.
-- 4. action_cards        effort and depends_on (other actions that should come first), set by the orchestrator.
--
-- RLS on every table; members read their own organization's rows; all writes go through the functions below.

-- ── 1. research library ──────────────────────────────────────────────────────
create table public.research_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'keyword' check (kind in ('keyword')),
  source text not null check (source in ('semrush_export', 'search_console_export', 'owner')),
  term text not null check (length(term) between 1 and 200),
  -- { volume, difficulty, position, cpc, url, intent, clicks, impressions } as the source reported them (numbers or short text)
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object' and length(metrics::text) <= 2000),
  previous_metrics jsonb check (previous_metrics is null or jsonb_typeof(previous_metrics) = 'object'),
  previous_measured_on date,
  evidence_class text not null check (evidence_class in ('verified', 'inferred', 'estimated', 'unknown')),
  basis text check (basis is null or length(basis) between 1 and 400),
  -- When the source measured it (the export's date). Never in the future.
  measured_on date not null,
  imported_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint research_items_basis check (evidence_class = 'verified' or basis is not null)
);
create unique index research_items_term_idx on public.research_items (organization_id, source, kind, lower(term));
create index research_items_created_by_idx on public.research_items (created_by);

revoke all on public.research_items from anon, authenticated;
grant select on public.research_items to authenticated;
alter table public.research_items enable row level security;
create policy "Members read research items" on public.research_items for select to authenticated
  using (app_private.is_org_member(organization_id));

-- Imports keyword rows from one source and date. Each item: { term, metrics, evidence_class, basis }.
-- At most 500 per import and 2,000 per business. Returns how many rows were saved (new or updated).
create function public.import_research_items(p_org uuid, p_source text, p_measured_on date, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_item jsonb;
  v_term text;
  v_class text;
  v_n integer := 0;
begin
  if not app_private.can_act_for(p_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_source not in ('semrush_export', 'search_console_export', 'owner') then
    raise exception 'Unknown research source' using errcode = '22023', hint = 'invalid_source';
  end if;
  if p_measured_on is null or p_measured_on > current_date or p_measured_on < date '2000-01-01' then
    raise exception 'The date the data was measured is required and cannot be in the future' using errcode = '22023', hint = 'invalid_date';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 500 then
    raise exception 'Import between 1 and 500 rows at a time' using errcode = '22023', hint = 'invalid_items';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_term := btrim(coalesce(v_item ->> 'term', ''));
    v_class := v_item ->> 'evidence_class';
    if length(v_term) not between 1 and 200
       or v_class is null or v_class not in ('verified', 'inferred', 'estimated', 'unknown')
       or (v_class <> 'verified' and length(btrim(coalesce(v_item ->> 'basis', ''))) = 0)
       or jsonb_typeof(coalesce(v_item -> 'metrics', '{}'::jsonb)) <> 'object' then
      raise exception 'A research row is not in the expected shape' using errcode = '22023', hint = 'invalid_items';
    end if;
    insert into public.research_items (organization_id, kind, source, term, metrics, evidence_class, basis, measured_on, created_by)
    values (p_org, 'keyword', p_source, v_term, coalesce(v_item -> 'metrics', '{}'::jsonb), v_class,
            nullif(left(btrim(coalesce(v_item ->> 'basis', '')), 400), ''), p_measured_on, (select auth.uid()))
    on conflict (organization_id, source, kind, lower(term)) do update
      set previous_metrics = case when public.research_items.measured_on <> excluded.measured_on then public.research_items.metrics else public.research_items.previous_metrics end,
          previous_measured_on = case when public.research_items.measured_on <> excluded.measured_on then public.research_items.measured_on else public.research_items.previous_measured_on end,
          metrics = excluded.metrics, evidence_class = excluded.evidence_class, basis = excluded.basis,
          measured_on = excluded.measured_on, imported_at = now(), term = excluded.term
      -- An older export never overwrites newer figures.
      where public.research_items.measured_on <= excluded.measured_on;
    if found then v_n := v_n + 1; end if;
  end loop;
  if (select count(*) from public.research_items where organization_id = p_org) > 2000 then
    raise exception 'The research library holds up to 2,000 keywords' using errcode = 'P0001', hint = 'research_limit';
  end if;
  perform app_private.log_activity(p_org, 'research.imported', 'research_items', null,
    jsonb_build_object('source', p_source, 'measured_on', p_measured_on, 'rows', v_n));
  return v_n;
end $$;

create function public.remove_research_item(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.research_items where id = p_id;
  if v_org is null or not app_private.is_org_member(v_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  delete from public.research_items where id = p_id;
  perform app_private.log_activity(v_org, 'research.removed', 'research_item', p_id::text, '{}'::jsonb);
end $$;

-- ── 2. performance history ───────────────────────────────────────────────────
create table public.performance_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  metric text not null check (metric in (
    'website_visits', 'search_impressions', 'search_clicks', 'average_position', 'calls', 'form_leads',
    'email_opens', 'email_clicks', 'new_customers', 'reviews_received')),
  period_start date not null,
  period_end date not null,
  value numeric not null check (value >= 0 and value < 1e12),
  -- Who supplied the figure. Something Clicks never measures these itself today.
  source text not null check (source in ('owner_entered', 'search_console_export', 'analytics_export')),
  note text check (note is null or length(note) <= 300),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  constraint performance_metrics_period check (period_end >= period_start and period_end - period_start <= 366),
  constraint performance_metrics_position check (metric <> 'average_position' or value >= 1),
  unique (organization_id, metric, period_start, period_end, source)
);
create index performance_metrics_org_idx on public.performance_metrics (organization_id, metric, period_end desc);
create index performance_metrics_recorded_by_idx on public.performance_metrics (recorded_by);

revoke all on public.performance_metrics from anon, authenticated;
grant select on public.performance_metrics to authenticated;
alter table public.performance_metrics enable row level security;
create policy "Members read performance metrics" on public.performance_metrics for select to authenticated
  using (app_private.is_org_member(organization_id));

-- Records supplied figures. Each row: { metric, period_start, period_end, value, note }. Re-recording the same metric,
-- period and source replaces the value (a correction). Periods cannot end in the future.
create function public.record_performance_metrics(p_org uuid, p_source text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_n integer := 0;
  v_start date;
  v_end date;
begin
  if not app_private.can_act_for(p_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_source not in ('owner_entered', 'search_console_export', 'analytics_export') then
    raise exception 'Unknown source' using errcode = '22023', hint = 'invalid_source';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 200 then
    raise exception 'Record between 1 and 200 figures at a time' using errcode = '22023', hint = 'invalid_rows';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row -> 'value') is distinct from 'number' then
      raise exception 'Each figure needs a number' using errcode = '22023', hint = 'invalid_rows';
    end if;
    v_start := (v_row ->> 'period_start')::date;
    v_end := (v_row ->> 'period_end')::date;
    if v_end > current_date then
      raise exception 'A period cannot end in the future' using errcode = '22023', hint = 'future_period';
    end if;
    insert into public.performance_metrics (organization_id, metric, period_start, period_end, value, source, note, recorded_by)
    values (p_org, v_row ->> 'metric', v_start, v_end, (v_row ->> 'value')::numeric, p_source,
            nullif(left(btrim(coalesce(v_row ->> 'note', '')), 300), ''), (select auth.uid()))
    on conflict (organization_id, metric, period_start, period_end, source) do update
      set value = excluded.value, note = excluded.note, recorded_by = excluded.recorded_by, recorded_at = now();
    v_n := v_n + 1;
  end loop;
  perform app_private.log_activity(p_org, 'performance.recorded', 'performance_metrics', null,
    jsonb_build_object('source', p_source, 'rows', v_n));
  return v_n;
end $$;

create function public.remove_performance_metric(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.performance_metrics where id = p_id;
  if v_org is null or not app_private.is_org_member(v_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  delete from public.performance_metrics where id = p_id;
  perform app_private.log_activity(v_org, 'performance.removed', 'performance_metric', p_id::text, '{}'::jsonb);
end $$;

-- ── 3. execution records ─────────────────────────────────────────────────────
create table public.execution_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  action text not null check (action in (
    -- supported: performed by the application itself
    'save_to_workspace', 'record_completed',
    -- not supported: no authorized integration exists; requests are recorded as 'unsupported' and never run
    'publish_website', 'send_email', 'schedule_social', 'spend_ads')),
  card_id uuid references public.action_cards (id) on delete set null,
  task_id uuid references public.campaign_tasks (id) on delete set null,
  approval_id uuid references public.approvals (id) on delete set null,
  -- The exact approved version that was executed (for drafts).
  draft_version_id uuid references public.draft_versions (id) on delete set null,
  -- requested → authorized (owner) → succeeded | failed;  unsupported (no integration);  cancelled
  status text not null check (status in ('requested', 'authorized', 'succeeded', 'failed', 'unsupported', 'cancelled')),
  integration text check (integration is null or integration in ('workspace', 'owner_report')),
  -- What was executed: the deliverable as approved, copied at execution so later edits cannot change the record.
  deliverable jsonb check (deliverable is null or length(deliverable::text) <= 20000),
  request_note text check (request_note is null or length(request_note) <= 500),
  result text check (result is null or length(result) <= 500),
  error text check (error is null or length(error) <= 500),
  -- Set later by a website check for work it can see: verified (the issue is gone) or not_verified (still found).
  verification text check (verification is null or verification in ('verified', 'not_verified')),
  verified_at timestamptz,
  idempotency_key text not null check (length(idempotency_key) between 8 and 100),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  authorized_by uuid references auth.users (id) on delete set null,
  authorized_at timestamptz,
  executed_at timestamptz,
  unique (organization_id, idempotency_key),
  constraint execution_records_target check (num_nonnulls(card_id, task_id) >= 1 or status in ('cancelled'))
);
create index execution_records_org_idx on public.execution_records (organization_id, requested_at desc);
create index execution_records_card_idx on public.execution_records (card_id);
create index execution_records_task_idx on public.execution_records (task_id);
create index execution_records_approval_idx on public.execution_records (approval_id);
create index execution_records_version_idx on public.execution_records (draft_version_id);
create index execution_records_requested_by_idx on public.execution_records (requested_by);
create index execution_records_authorized_by_idx on public.execution_records (authorized_by);
-- No duplicate execution: one open request per action and target.
create unique index execution_records_one_open_card_idx on public.execution_records (card_id, action)
  where status in ('requested', 'authorized') and card_id is not null;
create unique index execution_records_one_open_task_idx on public.execution_records (task_id, action)
  where status in ('requested', 'authorized') and task_id is not null;

revoke all on public.execution_records from anon, authenticated;
grant select on public.execution_records to authenticated;
alter table public.execution_records enable row level security;
create policy "Members read execution records" on public.execution_records for select to authenticated
  using (app_private.is_org_member(organization_id));

-- Any member may request. A repeated key returns the earlier request (safe retries). Unsupported actions are recorded and
-- closed at once with the reason. A recommendation is never permission: nothing runs until the owner authorizes it.
create function public.request_execution(p_org uuid, p_action text, p_card uuid, p_task uuid, p_note text, p_key text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_supported boolean := p_action in ('save_to_workspace', 'record_completed');
begin
  if not app_private.is_org_member(p_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_action not in ('save_to_workspace', 'record_completed', 'publish_website', 'send_email', 'schedule_social', 'spend_ads') then
    raise exception 'Unknown action' using errcode = '22023', hint = 'invalid_action';
  end if;
  if p_key is null or length(p_key) not between 8 and 100 then raise exception 'A request key is required' using errcode = '22023'; end if;
  select id into v_id from public.execution_records where organization_id = p_org and idempotency_key = p_key;
  if v_id is not null then return v_id; end if;
  if num_nonnulls(p_card, p_task) <> 1 then raise exception 'Name one action or one task' using errcode = '22023'; end if;
  if p_card is not null and not exists (select 1 from public.action_cards where id = p_card and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_task is not null and not exists (select 1 from public.campaign_tasks where id = p_task and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_action = 'save_to_workspace' and p_card is not null and not exists (
       select 1 from public.approvals where action_card_id = p_card and decision = 'approved' and approved_version_id is not null) then
    raise exception 'Approve a draft first' using errcode = 'P0001', hint = 'needs_approved_draft';
  end if;
  if p_action = 'save_to_workspace' and p_task is not null and not exists (
       select 1 from public.campaign_tasks where id = p_task and status in ('approved', 'done') and deliverable is not null) then
    raise exception 'Approve the task with its draft first' using errcode = 'P0001', hint = 'needs_approved_draft';
  end if;
  begin
    insert into public.execution_records (organization_id, action, card_id, task_id, status, error, request_note, idempotency_key, requested_by)
    values (p_org, p_action, p_card, p_task,
            case when v_supported then 'requested' else 'unsupported' end,
            case when v_supported then null else 'No authorized integration exists for this. Nothing was published, sent or spent.' end,
            nullif(left(btrim(coalesce(p_note, '')), 500), ''), p_key, (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This is already waiting' using errcode = 'P0001', hint = 'already_open';
  end;
  perform app_private.log_activity(p_org, 'execution.requested', 'execution_record', v_id::text,
    jsonb_build_object('action', p_action, 'supported', v_supported));
  return v_id;
end $$;

-- Only the owner authorizes. Separate from approving a draft.
create function public.authorize_execution(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rec record;
begin
  select id, organization_id, status into v_rec from public.execution_records where id = p_id for update;
  if v_rec.id is null or not app_private.is_org_member(v_rec.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if not app_private.has_org_role(v_rec.organization_id, 'owner') then
    raise exception 'Only the account owner can authorize this' using errcode = '42501', hint = 'owner_only';
  end if;
  if v_rec.status <> 'requested' then raise exception 'This is not waiting for authorization' using errcode = 'P0001', hint = 'not_requested'; end if;
  update public.execution_records set status = 'authorized', authorized_by = (select auth.uid()), authorized_at = now() where id = p_id;
  perform app_private.log_activity(v_rec.organization_id, 'execution.authorized', 'execution_record', p_id::text, '{}'::jsonb);
end $$;

-- Performs an authorized action (any member may run it once authorized; it runs once). Both supported actions are carried
-- out inside the application: saving the approved deliverable to the workspace, or recording that the team did the work
-- themselves (reported, not verified, until a website check can see it).
create function public.execute_authorized(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_rec record;
  v_ver record;
  v_task record;
begin
  select * into v_rec from public.execution_records where id = p_id for update;
  if v_rec.id is null or not app_private.is_org_member(v_rec.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if v_rec.status <> 'authorized' then
    raise exception 'Only an authorized request can be executed' using errcode = 'P0001', hint = 'not_authorized';
  end if;

  if v_rec.action = 'save_to_workspace' then
    if v_rec.card_id is not null then
      select dv.id, dv.fields, ap.id as approval_id into v_ver
        from public.approvals ap join public.draft_versions dv on dv.id = ap.approved_version_id
       where ap.action_card_id = v_rec.card_id and ap.decision = 'approved'
       order by ap.decided_at desc nulls last limit 1;
      if v_ver.id is null then
        update public.execution_records set status = 'failed', executed_at = now(), error = 'The approved draft is no longer available.' where id = p_id;
        return 'failed';
      end if;
      update public.execution_records
         set status = 'succeeded', integration = 'workspace', executed_at = now(), approval_id = v_ver.approval_id,
             draft_version_id = v_ver.id, deliverable = v_ver.fields, result = 'Saved the approved draft to your workspace.'
       where id = p_id;
    else
      select id, coalesce(deliverable_edited, deliverable) as text, status into v_task from public.campaign_tasks where id = v_rec.task_id;
      if v_task.id is null or v_task.text is null or v_task.status not in ('approved', 'done') then
        update public.execution_records set status = 'failed', executed_at = now(), error = 'The approved task draft is no longer available.' where id = p_id;
        return 'failed';
      end if;
      update public.execution_records
         set status = 'succeeded', integration = 'workspace', executed_at = now(),
             deliverable = jsonb_build_object('text', v_task.text), result = 'Saved the approved draft to your workspace.'
       where id = p_id;
    end if;
  elsif v_rec.action = 'record_completed' then
    if v_rec.card_id is not null then
      update public.action_cards
         set status = 'done', completed_at = now(),
             result_summary = coalesce(v_rec.request_note, 'Marked done by your team.')
       where id = v_rec.card_id and status in ('new', 'approved', 'in_progress');
    else
      update public.campaign_tasks set status = 'done', done_at = now(), done_by = (select auth.uid()), note = coalesce(note, v_rec.request_note)
       where id = v_rec.task_id and status = 'approved';
    end if;
    update public.execution_records
       set status = 'succeeded', integration = 'owner_report', executed_at = now(),
           result = 'Recorded as done by your team. A later website check verifies it where it can.'
     where id = p_id;
  else
    -- Cannot happen: unsupported actions never reach 'authorized'. Fail closed anyway.
    update public.execution_records set status = 'failed', executed_at = now(), error = 'No integration exists for this.' where id = p_id;
    return 'failed';
  end if;
  perform app_private.log_activity(v_rec.organization_id, 'execution.succeeded', 'execution_record', p_id::text,
    jsonb_build_object('action', v_rec.action));
  return 'succeeded';
end $$;

create function public.cancel_execution(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rec record;
begin
  select id, organization_id, status into v_rec from public.execution_records where id = p_id for update;
  if v_rec.id is null or not app_private.is_org_member(v_rec.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if v_rec.status not in ('requested', 'authorized') then raise exception 'This can no longer be cancelled' using errcode = 'P0001', hint = 'closed'; end if;
  update public.execution_records set status = 'cancelled' where id = p_id;
  perform app_private.log_activity(v_rec.organization_id, 'execution.cancelled', 'execution_record', p_id::text, '{}'::jsonb);
end $$;

-- A website check that verifies a card (verify_outcomes) also verifies the work recorded for it.
create function app_private.verify_execution_records() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.verification is distinct from old.verification and new.verification is not null then
    update public.execution_records
       set verification = case new.verification when 'fixed' then 'verified' else 'not_verified' end, verified_at = now()
     where card_id = new.id and status = 'succeeded' and action = 'record_completed';
  end if;
  return new;
end $$;
create trigger action_cards_verify_execution after update of verification on public.action_cards
  for each row execute function app_private.verify_execution_records();

-- ── 4. action card effort and dependencies ───────────────────────────────────
alter table public.action_cards
  add column effort text check (effort is null or effort in ('small', 'medium', 'large')),
  add column depends_on uuid[] not null default '{}' check (cardinality(depends_on) <= 5);

-- Sets effort and dependencies on the cards of one analysis, by check: rows [{ check_key, effort, depends_on: [check_key] }].
-- Dependencies resolve to cards of the same analysis only (so they are always this business's own actions); a dependency
-- on a check that did not fire in this analysis is ignored.
create function public.annotate_action_cards(p_analysis uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_row jsonb;
  v_deps uuid[];
  v_n integer := 0;
begin
  select organization_id into v_org from public.analyses where id = p_analysis;
  if v_org is null or not app_private.can_act_for(v_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'Invalid rows' using errcode = '22023';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row -> 'check_key') is distinct from 'string'
       or (v_row ->> 'effort') is not null and (v_row ->> 'effort') not in ('small', 'medium', 'large')
       or jsonb_typeof(coalesce(v_row -> 'depends_on', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(v_row -> 'depends_on', '[]'::jsonb)) > 5 then
      raise exception 'Invalid annotation' using errcode = '22023';
    end if;
    select coalesce(array_agg(c.id), '{}') into v_deps
      from public.action_cards c
     where c.analysis_id = p_analysis and c.check_key <> (v_row ->> 'check_key')
       and c.check_key in (select jsonb_array_elements_text(coalesce(v_row -> 'depends_on', '[]'::jsonb)));
    update public.action_cards set effort = v_row ->> 'effort', depends_on = v_deps[1:5]
     where analysis_id = p_analysis and check_key = v_row ->> 'check_key';
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────
revoke all on function
  public.import_research_items(uuid, text, date, jsonb), public.remove_research_item(uuid),
  public.record_performance_metrics(uuid, text, jsonb), public.remove_performance_metric(uuid),
  public.request_execution(uuid, text, uuid, uuid, text, text), public.authorize_execution(uuid),
  public.execute_authorized(uuid), public.cancel_execution(uuid),
  public.annotate_action_cards(uuid, jsonb), app_private.verify_execution_records()
  from public, anon, authenticated;
grant execute on function
  public.import_research_items(uuid, text, date, jsonb), public.remove_research_item(uuid),
  public.record_performance_metrics(uuid, text, jsonb), public.remove_performance_metric(uuid),
  public.request_execution(uuid, text, uuid, uuid, text, text), public.authorize_execution(uuid),
  public.execute_authorized(uuid), public.cancel_execution(uuid),
  public.annotate_action_cards(uuid, jsonb)
  to authenticated;
grant execute on function
  public.import_research_items(uuid, text, date, jsonb), public.record_performance_metrics(uuid, text, jsonb),
  public.annotate_action_cards(uuid, jsonb)
  to service_role;
