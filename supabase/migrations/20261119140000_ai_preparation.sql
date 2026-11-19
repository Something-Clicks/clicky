-- Phase 4: AI preparation and controlled execution.
--
-- agent_runs: one record per AI preparation (what it was asked, what it was allowed to
--             do, what it produced, cost, outcome). Never edited by API roles.
-- approvals:  the owner's decision on each prepared draft.
--
-- Controls:
--   * An agent run can only PREPARE a draft (permission 'draft_only'). It has no tools and
--     cannot publish or change anything outside this database.
--   * Only an organization OWNER can approve, reject or request changes (enforced here).
--   * One active run per card; 20 runs per organization per day.
--   * Every step writes activity_log.

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  action_card_id uuid not null references public.action_cards (id) on delete cascade,
  draft_type text not null check (draft_type in ('page_copy', 'meta', 'gbp_post', 'review_reply', 'blog_draft')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  permission text not null default 'draft_only' check (permission = 'draft_only'),
  instructions text check (instructions is null or length(instructions) <= 1000),
  model text check (model is null or length(model) <= 100),
  -- Draft as { "fields": [ { "key", "label", "text" } ] }
  output jsonb,
  usage jsonb,
  error text check (error is null or length(error) <= 500),
  started_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index agent_runs_org_idx on public.agent_runs (organization_id, started_at desc);
create index agent_runs_card_idx on public.agent_runs (action_card_id);
create index agent_runs_started_by_idx on public.agent_runs (started_by);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  agent_run_id uuid not null unique references public.agent_runs (id) on delete cascade,
  action_card_id uuid not null references public.action_cards (id) on delete cascade,
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'rejected', 'changes_requested')),
  note text check (note is null or length(note) <= 1000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index approvals_org_idx on public.approvals (organization_id, decision);
create index approvals_card_idx on public.approvals (action_card_id);
create index approvals_decided_by_idx on public.approvals (decided_by);

revoke all on public.agent_runs, public.approvals from anon, authenticated;
grant select on public.agent_runs, public.approvals to authenticated;
alter table public.agent_runs enable row level security;
alter table public.approvals enable row level security;
create policy "Members read agent runs" on public.agent_runs for select to authenticated
  using (app_private.is_org_member(organization_id));
create policy "Members read approvals" on public.approvals for select to authenticated
  using (app_private.is_org_member(organization_id));

-- Starts preparing a draft for an open, AI-capable card.
create function public.start_agent_run(p_card uuid, p_instructions text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_card record;
  v_id uuid;
begin
  select id, organization_id, status, ai_capable, execution_type into v_card
  from public.action_cards where id = p_card for update;
  if v_card.id is null or not app_private.is_org_member(v_card.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
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

-- Records a prepared draft and puts it in the approval queue.
create function public.complete_agent_run(p_run uuid, p_output jsonb, p_model text, p_usage jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_run record;
  v_approval uuid;
  v_field jsonb;
begin
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

create function public.fail_agent_run(p_run uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_run record;
begin
  select id, organization_id, action_card_id into v_run from public.agent_runs where id = p_run;
  if v_run.id is null or not app_private.is_org_member(v_run.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.agent_runs set status = 'failed', error = left(p_reason, 500), completed_at = now()
  where id = p_run and status = 'running';
  if found then
    -- Nothing was prepared: the card goes back to "new" unless another draft exists.
    update public.action_cards set status = 'new'
    where id = v_run.action_card_id and status = 'in_progress'
      and not exists (select 1 from public.approvals where action_card_id = v_run.action_card_id and decision in ('pending', 'approved'));
    perform app_private.log_activity(v_run.organization_id, 'agent_run.failed', 'agent_run', p_run::text, '{}'::jsonb);
  end if;
end $$;

-- The owner's decision on a prepared draft. Only owners may decide.
create function public.decide_approval(p_approval uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ap record;
begin
  select id, organization_id, action_card_id, decision into v_ap from public.approvals where id = p_approval for update;
  if v_ap.id is null or not app_private.is_org_member(v_ap.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not app_private.has_org_role(v_ap.organization_id, 'owner') then
    raise exception 'Only the account owner can approve drafts' using errcode = '42501', hint = 'owner_only';
  end if;
  if p_decision not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if v_ap.decision <> 'pending' then
    raise exception 'This draft was already decided' using errcode = 'P0001', hint = 'already_decided';
  end if;

  update public.approvals
  set decision = p_decision, note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
      decided_by = (select auth.uid()), decided_at = now()
  where id = p_approval;
  update public.action_cards
  set status = case when p_decision = 'approved' then 'approved' else 'new' end,
      result_summary = case
        when p_decision = 'approved' then 'Draft approved. Use it on your website or profile, then mark this done.'
        when p_decision = 'changes_requested' then 'Changes requested. Prepare a new draft with your notes.'
        else 'Draft rejected.' end
  where id = v_ap.action_card_id and status in ('new', 'in_progress', 'approved');
  perform app_private.log_activity(v_ap.organization_id, 'approval.' || p_decision, 'approval', p_approval::text,
    jsonb_build_object('action_card_id', v_ap.action_card_id));
end $$;

-- Platform admin: recent runs across organizations, without draft content.
create function public.admin_agent_runs() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not app_private.is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform app_private.log_activity(null, 'admin.agent_runs_viewed', null, null, '{}'::jsonb);
  select jsonb_build_object(
    'last_day', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.agent_runs where started_at > now() - interval '1 day' group by status) s),
    'runs', coalesce((select jsonb_agg(row_to_json(r)) from (
      select ar.id, o.name as organization, ar.draft_type, ar.status, ar.model, ar.error,
             ar.usage, ar.started_at, ar.completed_at
      from public.agent_runs ar join public.organizations o on o.id = ar.organization_id
      order by ar.started_at desc limit 100) r), '[]'::jsonb)
  ) into v;
  return v;
end $$;

revoke all on function public.start_agent_run(uuid, text), public.complete_agent_run(uuid, jsonb, text, jsonb),
  public.fail_agent_run(uuid, text), public.decide_approval(uuid, text, text), public.admin_agent_runs()
  from public, anon, authenticated;
grant execute on function public.start_agent_run(uuid, text), public.complete_agent_run(uuid, jsonb, text, jsonb),
  public.fail_agent_run(uuid, text), public.decide_approval(uuid, text, text), public.admin_agent_runs()
  to authenticated;
