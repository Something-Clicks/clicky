-- Phase 3: marketing intelligence.
--
-- Tables: data_connections, analyses, analysis_evidence, action_cards, action_card_evidence.
--
-- Same security model as Phase 1: RLS on, API roles get SELECT only (and only for their
-- organization). All writes go through SECURITY DEFINER functions that check membership,
-- the analysis state and rate limits, and write activity_log.
--
-- Accepted risk (documented in docs/phases/PHASE3.md): a member can call
-- complete_analysis with hand-made results for their OWN organization. It cannot touch
-- any other tenant, and every call is logged.

-- ── data connections ─────────────────────────────────────────────────────────
create table public.data_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('website', 'pagespeed', 'search_console', 'google_business_profile')),
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'disconnected')),
  scopes text[] not null default '{}',
  account_identity text check (account_identity is null or length(account_identity) <= 300),
  -- Reference to a Supabase Vault secret holding OAuth tokens. Never a raw token.
  token_ref uuid,
  last_synced_at timestamptz,
  sync_status text check (sync_status is null or sync_status in ('ok', 'stale', 'failed')),
  last_error text check (last_error is null or length(last_error) <= 500),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);
create trigger data_connections_updated_at before update on public.data_connections
  for each row execute function app_private.touch_updated_at();

-- ── analyses ─────────────────────────────────────────────────────────────────
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  website text,
  -- Per source: { "website": "observed", "pagespeed": "missing", ... } plus notes.
  source_coverage jsonb not null default '{}'::jsonb,
  summary text check (summary is null or length(summary) <= 2000),
  wording text check (wording is null or wording in ('ai', 'template')),
  failure_reason text check (failure_reason is null or length(failure_reason) <= 500),
  triggered_by uuid references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index analyses_org_idx on public.analyses (organization_id, started_at desc);
create index analyses_triggered_by_idx on public.analyses (triggered_by);

create table public.analysis_evidence (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null check (source in ('website', 'pagespeed', 'search_console', 'google_business_profile')),
  kind text not null check (kind in ('observed', 'measured', 'estimated', 'missing')),
  check_key text not null check (check_key ~ '^[a-z0-9_.]+$' and length(check_key) <= 80),
  url text check (url is null or length(url) <= 500),
  observation text not null check (length(observation) between 1 and 1000),
  excerpt text check (excerpt is null or length(excerpt) <= 1000),
  measurement jsonb,
  observed_at timestamptz not null default now()
);
create index analysis_evidence_analysis_idx on public.analysis_evidence (analysis_id);
create index analysis_evidence_org_idx on public.analysis_evidence (organization_id);

-- ── action cards ─────────────────────────────────────────────────────────────
create table public.action_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  check_key text not null,
  title text not null check (length(title) between 1 and 160),
  explanation text not null check (length(explanation) between 1 and 1000),
  why_it_matters text not null check (length(why_it_matters) between 1 and 1000),
  recommended_action text not null check (length(recommended_action) between 1 and 1000),
  expected_benefit text not null check (length(expected_benefit) between 1 and 600),
  impact_priority text not null check (impact_priority in ('high', 'medium', 'low')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  ai_capable boolean not null default false,
  execution_type text not null default 'manual'
    check (execution_type in ('page_copy', 'meta', 'gbp_post', 'review_reply', 'blog_draft', 'manual')),
  approval_required boolean not null default true,
  status text not null default 'new'
    check (status in ('new', 'approved', 'in_progress', 'done', 'failed', 'dismissed')),
  wording text not null default 'template' check (wording in ('ai', 'template')),
  result_summary text check (result_summary is null or length(result_summary) <= 1000),
  failure_reason text check (failure_reason is null or length(failure_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index action_cards_org_idx on public.action_cards (organization_id, status);
create index action_cards_analysis_idx on public.action_cards (analysis_id);
create trigger action_cards_updated_at before update on public.action_cards
  for each row execute function app_private.touch_updated_at();

create table public.action_card_evidence (
  action_card_id uuid not null references public.action_cards (id) on delete cascade,
  evidence_id uuid not null references public.analysis_evidence (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  primary key (action_card_id, evidence_id)
);
create index action_card_evidence_evidence_idx on public.action_card_evidence (evidence_id);
create index action_card_evidence_org_idx on public.action_card_evidence (organization_id);

-- ── privileges and RLS: members read their organization; nobody writes directly ─
revoke all on public.data_connections, public.analyses, public.analysis_evidence,
  public.action_cards, public.action_card_evidence from anon, authenticated;
grant select on public.data_connections, public.analyses, public.analysis_evidence,
  public.action_cards, public.action_card_evidence to authenticated;

alter table public.data_connections enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_evidence enable row level security;
alter table public.action_cards enable row level security;
alter table public.action_card_evidence enable row level security;

create policy "Members read connections" on public.data_connections for select to authenticated
  using (app_private.is_org_member(organization_id));
create policy "Members read analyses" on public.analyses for select to authenticated
  using (app_private.is_org_member(organization_id));
create policy "Members read evidence" on public.analysis_evidence for select to authenticated
  using (app_private.is_org_member(organization_id));
create policy "Members read action cards" on public.action_cards for select to authenticated
  using (app_private.is_org_member(organization_id));
create policy "Members read card evidence" on public.action_card_evidence for select to authenticated
  using (app_private.is_org_member(organization_id));

-- ── functions ────────────────────────────────────────────────────────────────

-- Starts an analysis for an organization the caller belongs to.
-- One at a time per organization (a run older than 15 minutes counts as abandoned),
-- and at most 10 per organization per day.
create function public.start_analysis(p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_website text;
begin
  if v_uid is null or not app_private.is_org_member(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  -- Serialize starts per organization.
  perform 1 from public.organizations where id = p_org for update;

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
  values (p_org, v_website, v_uid) returning id into v_id;
  perform app_private.log_activity(p_org, 'analysis.started', 'analysis', v_id::text, '{}'::jsonb);
  return v_id;
end $$;

-- Saves the results of a running analysis.
--   p_evidence: [{ key, source, kind, check_key, url, observation, excerpt, measurement }]
--   p_cards:    [{ check_key, title, explanation, why_it_matters, recommended_action,
--                  expected_benefit, impact_priority, confidence, ai_capable,
--                  execution_type, approval_required, evidence_keys: [key, ...] }]
-- Every card must cite at least one evidence item from this analysis.
-- New cards from earlier analyses that were not acted on are dismissed as replaced.
create function public.complete_analysis(
  p_analysis uuid, p_evidence jsonb, p_cards jsonb, p_coverage jsonb, p_summary text, p_wording text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_status text;
  v_ev jsonb;
  v_card jsonb;
  v_key text;
  v_card_id uuid;
  v_keys jsonb := '{}'::jsonb;
  v_ev_id uuid;
  v_cited int;
begin
  select organization_id, status into v_org, v_status from public.analyses where id = p_analysis for update;
  if v_org is null or not app_private.is_org_member(v_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if v_status <> 'running' then
    raise exception 'Analysis is not running' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_typeof(p_cards) <> 'array'
     or jsonb_array_length(p_evidence) > 200 or jsonb_array_length(p_cards) > 30 then
    raise exception 'Invalid analysis payload' using errcode = '22023';
  end if;

  for v_ev in select * from jsonb_array_elements(p_evidence) loop
    insert into public.analysis_evidence
      (analysis_id, organization_id, source, kind, check_key, url, observation, excerpt, measurement)
    values (p_analysis, v_org, v_ev ->> 'source', v_ev ->> 'kind', v_ev ->> 'check_key',
            v_ev ->> 'url', v_ev ->> 'observation', v_ev ->> 'excerpt', v_ev -> 'measurement')
    returning id into v_ev_id;
    v_keys := v_keys || jsonb_build_object(v_ev ->> 'key', v_ev_id);
  end loop;

  update public.action_cards
  set status = 'dismissed', result_summary = 'Replaced by a newer analysis.'
  where organization_id = v_org and status = 'new' and analysis_id <> p_analysis;

  for v_card in select * from jsonb_array_elements(p_cards) loop
    insert into public.action_cards (
      organization_id, analysis_id, check_key, title, explanation, why_it_matters, recommended_action,
      expected_benefit, impact_priority, confidence, ai_capable, execution_type, approval_required, wording)
    values (
      v_org, p_analysis, v_card ->> 'check_key', v_card ->> 'title', v_card ->> 'explanation',
      v_card ->> 'why_it_matters', v_card ->> 'recommended_action', v_card ->> 'expected_benefit',
      v_card ->> 'impact_priority', v_card ->> 'confidence',
      coalesce((v_card ->> 'ai_capable')::boolean, false), coalesce(v_card ->> 'execution_type', 'manual'),
      coalesce((v_card ->> 'approval_required')::boolean, true), coalesce(p_wording, 'template'))
    returning id into v_card_id;

    v_cited := 0;
    for v_key in select jsonb_array_elements_text(coalesce(v_card -> 'evidence_keys', '[]'::jsonb)) loop
      if v_keys ? v_key then
        insert into public.action_card_evidence (action_card_id, evidence_id, organization_id)
        values (v_card_id, (v_keys ->> v_key)::uuid, v_org) on conflict do nothing;
        v_cited := v_cited + 1;
      end if;
    end loop;
    if v_cited = 0 then
      raise exception 'Every action card must cite evidence from this analysis' using errcode = '22023';
    end if;
  end loop;

  update public.analyses
  set status = 'complete', completed_at = now(), source_coverage = coalesce(p_coverage, '{}'::jsonb),
      summary = left(p_summary, 2000), wording = p_wording
  where id = p_analysis;

  insert into public.data_connections (organization_id, provider, status, last_synced_at, sync_status)
  values (v_org, 'website', 'connected', now(), 'ok')
  on conflict (organization_id, provider) do update
    set status = 'connected', last_synced_at = now(), sync_status = 'ok', last_error = null;

  perform app_private.log_activity(v_org, 'analysis.completed', 'analysis', p_analysis::text,
    jsonb_build_object('cards', jsonb_array_length(p_cards), 'evidence', jsonb_array_length(p_evidence)));
end $$;

create function public.fail_analysis(p_analysis uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.analyses where id = p_analysis;
  if v_org is null or not app_private.is_org_member(v_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.analyses set status = 'failed', failure_reason = left(p_reason, 500), completed_at = now()
  where id = p_analysis and status = 'running';
  if found then
    perform app_private.log_activity(v_org, 'analysis.failed', 'analysis', p_analysis::text, '{}'::jsonb);
  end if;
end $$;

-- Owner or member marks a card done (work done outside the product) or dismisses it.
create function public.set_action_card_status(p_card uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_old text;
begin
  select organization_id, status into v_org, v_old from public.action_cards where id = p_card for update;
  if v_org is null or not app_private.is_org_member(v_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_status not in ('done', 'dismissed', 'new') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  update public.action_cards
  set status = p_status,
      completed_at = case when p_status = 'done' then now() else null end,
      result_summary = coalesce(nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
        case p_status when 'done' then 'Marked done by your team.' when 'dismissed' then 'Dismissed by your team.' else null end)
  where id = p_card;
  perform app_private.log_activity(v_org, 'action_card.' || p_status, 'action_card', p_card::text,
    jsonb_build_object('from', v_old));
end $$;

revoke all on function public.start_analysis(uuid),
  public.complete_analysis(uuid, jsonb, jsonb, jsonb, text, text),
  public.fail_analysis(uuid, text),
  public.set_action_card_status(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.start_analysis(uuid),
  public.complete_analysis(uuid, jsonb, jsonb, jsonb, text, text),
  public.fail_analysis(uuid, text),
  public.set_action_card_status(uuid, text, text)
  to authenticated;
