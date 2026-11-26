-- Market research (competitor pages the owner names) and campaigns (guided, owner-approved task lists).
-- Additive. Rollback: supabase/rollback/20261203120000_campaigns_and_research_down.sql
-- Nothing here publishes or sends anything: the owner does the work and records it.

-- ── competitor scans ─────────────────────────────────────────────────────────
create table public.competitor_scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  url text not null check (length(url) between 8 and 500),
  host text not null check (length(host) between 3 and 255),
  status text not null check (status in ('done', 'failed')),
  -- The business's own homepage, read the same way, so comparisons have a baseline. Not counted as a competitor.
  is_self boolean not null default false,
  -- What was observed on the public homepage: { phone, click_to_call, service_area, reviews, pricing, ... }
  signals jsonb not null default '{}'::jsonb check (jsonb_typeof(signals) = 'object' and length(signals::text) <= 8000),
  previous_signals jsonb check (previous_signals is null or jsonb_typeof(previous_signals) = 'object'),
  failure text check (failure is null or length(failure) <= 300),
  scanned_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (organization_id, host)
);
create index competitor_scans_created_by_idx on public.competitor_scans (created_by);
revoke all on public.competitor_scans from anon, authenticated;
grant select on public.competitor_scans to authenticated;
alter table public.competitor_scans enable row level security;
create policy "Members read competitor scans" on public.competitor_scans for select to authenticated
  using (app_private.is_org_member(organization_id));

create function public.save_competitor_scan(p_org uuid, p_url text, p_host text, p_status text, p_signals jsonb, p_failure text, p_is_self boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_old jsonb;
begin
  if not app_private.can_act_for(p_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_status not in ('done', 'failed') then raise exception 'Invalid status' using errcode = '22023'; end if;
  select id, case when status = 'done' then signals end into v_id, v_old from public.competitor_scans where organization_id = p_org and host = lower(p_host);
  if v_id is null and not p_is_self and (select count(*) from public.competitor_scans where organization_id = p_org and not is_self) >= 5 then
    raise exception 'You can compare up to 5 other websites' using errcode = 'P0001', hint = 'competitor_limit';
  end if;
  insert into public.competitor_scans (organization_id, url, host, status, is_self, signals, failure, created_by)
  values (p_org, p_url, lower(p_host), p_status, p_is_self, coalesce(p_signals, '{}'::jsonb), left(p_failure, 300), (select auth.uid()))
  on conflict (organization_id, host) do update
    set url = excluded.url, is_self = excluded.is_self, status = excluded.status, signals = excluded.signals, failure = excluded.failure,
        previous_signals = v_old, scanned_at = now()
  returning id into v_id;
  perform app_private.log_activity(p_org, 'research.competitor_scanned', 'competitor_scan', v_id::text, jsonb_build_object('status', p_status));
  return v_id;
end $$;

create function public.remove_competitor_scan(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.competitor_scans where id = p_id;
  if v_org is null or not app_private.is_org_member(v_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  delete from public.competitor_scans where id = p_id;
  perform app_private.log_activity(v_org, 'research.competitor_removed', 'competitor_scan', p_id::text, '{}'::jsonb);
end $$;

-- ── campaigns and tasks ──────────────────────────────────────────────────────
create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  playbook text not null check (length(playbook) between 1 and 60),
  title text not null check (length(title) between 1 and 160),
  goal text not null check (length(goal) between 1 and 300),
  summary text not null check (length(summary) between 1 and 600),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'completed', 'dismissed')),
  -- What it was built from: { cards: [...], competitors: [...], facts: [...] } (references and counts only)
  basis jsonb not null default '{}'::jsonb check (jsonb_typeof(basis) = 'object' and length(basis::text) <= 8000),
  created_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index marketing_campaigns_org_idx on public.marketing_campaigns (organization_id, created_at desc);
create index marketing_campaigns_created_by_idx on public.marketing_campaigns (created_by);
create index marketing_campaigns_decided_by_idx on public.marketing_campaigns (decided_by);

create table public.campaign_tasks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  position integer not null check (position between 1 and 20),
  kind text not null check (kind in ('fix_action', 'message', 'checklist', 'research')),
  title text not null check (length(title) between 1 and 160),
  why text not null check (length(why) between 1 and 500),
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 8),
  -- A fixed-template draft (never model-written). The owner may edit it; the edit is kept beside the original.
  deliverable text check (deliverable is null or length(deliverable) <= 4000),
  deliverable_edited text check (deliverable_edited is null or length(deliverable_edited) <= 4000),
  card_id uuid references public.action_cards (id) on delete set null,
  evidence_class text not null check (evidence_class in ('verified', 'inferred', 'estimated', 'unknown')),
  basis text check (basis is null or length(basis) <= 400),
  status text not null default 'prepared' check (status in ('prepared', 'approved', 'done', 'skipped')),
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  note text check (note is null or length(note) <= 500),
  unique (campaign_id, position),
  constraint campaign_tasks_basis check (evidence_class = 'verified' or basis is not null)
);
create index campaign_tasks_org_idx on public.campaign_tasks (organization_id);
create index campaign_tasks_card_idx on public.campaign_tasks (card_id);
create index campaign_tasks_done_by_idx on public.campaign_tasks (done_by);

revoke all on public.marketing_campaigns, public.campaign_tasks from anon, authenticated;
grant select on public.marketing_campaigns, public.campaign_tasks to authenticated;
alter table public.marketing_campaigns enable row level security;
alter table public.campaign_tasks enable row level security;
create policy "Members read campaigns" on public.marketing_campaigns for select to authenticated
  using (app_private.is_org_member(organization_id));
create policy "Members read campaign tasks" on public.campaign_tasks for select to authenticated
  using (app_private.is_org_member(organization_id));

-- Saves a proposed campaign with its tasks. Earlier proposed campaigns of the same playbook are dismissed.
-- A task that points at an Action Card must point at one of this business's open cards.
create function public.save_campaign(p_org uuid, p_campaign jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_task jsonb;
  v_pos integer := 0;
begin
  if not app_private.can_act_for(p_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_campaign -> 'tasks') is distinct from 'array' or jsonb_array_length(p_campaign -> 'tasks') not between 1 and 20
     or jsonb_typeof(p_campaign -> 'title') is distinct from 'string' or jsonb_typeof(p_campaign -> 'playbook') is distinct from 'string'
     or jsonb_typeof(p_campaign -> 'goal') is distinct from 'string' or jsonb_typeof(p_campaign -> 'summary') is distinct from 'string' then
    raise exception 'The campaign is not in the expected shape' using errcode = '22023', hint = 'invalid_campaign';
  end if;
  for v_task in select * from jsonb_array_elements(p_campaign -> 'tasks') loop
    if (v_task ->> 'card_id') is not null and not exists (
      select 1 from public.action_cards where id::text = v_task ->> 'card_id' and organization_id = p_org and status in ('new', 'approved', 'in_progress')) then
      raise exception 'A task must point at an open action of this business' using errcode = '22023', hint = 'unknown_card';
    end if;
  end loop;
  update public.marketing_campaigns set status = 'dismissed', decided_at = now()
   where organization_id = p_org and playbook = p_campaign ->> 'playbook' and status = 'proposed';
  insert into public.marketing_campaigns (organization_id, playbook, title, goal, summary, basis, created_by)
  values (p_org, p_campaign ->> 'playbook', p_campaign ->> 'title', p_campaign ->> 'goal', p_campaign ->> 'summary',
          coalesce(p_campaign -> 'basis', '{}'::jsonb), (select auth.uid()))
  returning id into v_id;
  for v_task in select * from jsonb_array_elements(p_campaign -> 'tasks') loop
    v_pos := v_pos + 1;
    insert into public.campaign_tasks (campaign_id, organization_id, position, kind, title, why, steps, deliverable, card_id, evidence_class, basis)
    values (v_id, p_org, v_pos, v_task ->> 'kind', v_task ->> 'title', v_task ->> 'why', coalesce(v_task -> 'steps', '[]'::jsonb),
            v_task ->> 'deliverable', nullif(v_task ->> 'card_id', '')::uuid, v_task ->> 'evidence_class', v_task ->> 'basis');
  end loop;
  perform app_private.log_activity(p_org, 'campaign.proposed', 'marketing_campaign', v_id::text, jsonb_build_object('tasks', v_pos));
  return v_id;
end $$;

-- The owner approves or dismisses a campaign. Approval is agreement to the work, never completion.
create function public.decide_campaign(p_campaign uuid, p_decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_c record;
begin
  select id, organization_id, status into v_c from public.marketing_campaigns where id = p_campaign for update;
  if v_c.id is null or not app_private.is_org_member(v_c.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if not app_private.has_org_role(v_c.organization_id, 'owner') then
    raise exception 'Only the account owner can approve a campaign' using errcode = '42501', hint = 'owner_only';
  end if;
  if p_decision not in ('approved', 'dismissed') then raise exception 'Invalid decision' using errcode = '22023'; end if;
  if v_c.status <> 'proposed' then raise exception 'This campaign was already decided' using errcode = 'P0001', hint = 'already_decided'; end if;
  update public.marketing_campaigns set status = p_decision, decided_by = (select auth.uid()), decided_at = now() where id = p_campaign;
  if p_decision = 'approved' then
    update public.campaign_tasks set status = 'approved' where campaign_id = p_campaign and status = 'prepared';
  end if;
  perform app_private.log_activity(v_c.organization_id, 'campaign.' || p_decision, 'marketing_campaign', p_campaign::text, '{}'::jsonb);
end $$;

-- A member edits the fixed-template draft of a task (kept beside the original).
create function public.edit_task_deliverable(p_task uuid, p_text text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t record;
begin
  select t.id, t.organization_id, t.deliverable, c.status as cstatus into v_t
    from public.campaign_tasks t join public.marketing_campaigns c on c.id = t.campaign_id where t.id = p_task;
  if v_t.id is null or not app_private.is_org_member(v_t.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if v_t.deliverable is null then raise exception 'This task has no draft' using errcode = '22023'; end if;
  if v_t.cstatus = 'dismissed' then raise exception 'This campaign was dismissed' using errcode = 'P0001'; end if;
  if p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 4000 then raise exception 'The draft must be 1 to 4000 characters' using errcode = '22023'; end if;
  update public.campaign_tasks set deliverable_edited = p_text where id = p_task;
  perform app_private.log_activity(v_t.organization_id, 'campaign.task_edited', 'campaign_task', p_task::text, '{}'::jsonb);
end $$;

-- A member records that a task is done (or skipped). Only after the owner approved the campaign.
-- When every task is done or skipped, the campaign is completed.
create function public.set_task_status(p_task uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t record;
begin
  select t.id, t.organization_id, t.campaign_id, c.status as cstatus into v_t
    from public.campaign_tasks t join public.marketing_campaigns c on c.id = t.campaign_id where t.id = p_task for update of t;
  if v_t.id is null or not app_private.is_org_member(v_t.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_status not in ('approved', 'done', 'skipped') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if v_t.cstatus not in ('approved', 'completed') then
    raise exception 'The owner has to approve the campaign first' using errcode = 'P0001', hint = 'not_approved';
  end if;
  update public.campaign_tasks set status = p_status, note = left(p_note, 500),
    done_at = case when p_status in ('done', 'skipped') then now() end,
    done_by = case when p_status in ('done', 'skipped') then (select auth.uid()) end
   where id = p_task;
  update public.marketing_campaigns set status = case
      when exists (select 1 from public.campaign_tasks where campaign_id = v_t.campaign_id and status in ('prepared', 'approved')) then 'approved'
      else 'completed' end
   where id = v_t.campaign_id and status in ('approved', 'completed');
  perform app_private.log_activity(v_t.organization_id, 'campaign.task_' || p_status, 'campaign_task', p_task::text, '{}'::jsonb);
end $$;

revoke all on function public.save_competitor_scan(uuid, text, text, text, jsonb, text, boolean), public.remove_competitor_scan(uuid),
  public.save_campaign(uuid, jsonb), public.decide_campaign(uuid, text), public.edit_task_deliverable(uuid, text),
  public.set_task_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_competitor_scan(uuid, text, text, text, jsonb, text, boolean), public.remove_competitor_scan(uuid),
  public.save_campaign(uuid, jsonb), public.decide_campaign(uuid, text), public.edit_task_deliverable(uuid, text),
  public.set_task_status(uuid, text, text) to authenticated;
