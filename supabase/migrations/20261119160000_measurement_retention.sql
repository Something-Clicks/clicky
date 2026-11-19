-- Phase 5: measurement, activity and retention.
--
-- * Outcomes: when an analysis completes, every action marked done or approved earlier
--   is re-checked against it. "fixed" only when the same check no longer fires AND the
--   source it depends on was observed/measured in this analysis; otherwise unchanged.
-- * Notification preferences (per person) and a notification log.
-- * Weekly re-analysis: a server-side worker (Supabase service role, server only) may
--   start/complete/fail analyses. Customer-facing paths are unchanged.

-- ── helpers ──────────────────────────────────────────────────────────────────
-- True only for requests made with the service role key (a server-side worker).
create function app_private.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
$$;

create function app_private.can_act_for(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.is_service() or app_private.is_org_member(p_org);
$$;
revoke all on function app_private.is_service(), app_private.can_act_for(uuid) from public, anon, authenticated;
grant usage on schema app_private to service_role;
grant execute on function app_private.is_service(), app_private.can_act_for(uuid), app_private.is_org_member(uuid) to authenticated, service_role;

-- ── outcomes ─────────────────────────────────────────────────────────────────
alter table public.action_cards
  add column verification text check (verification is null or verification in ('fixed', 'still_found')),
  add column verified_at timestamptz,
  add column verification_analysis_id uuid references public.analyses (id) on delete set null;
create index action_cards_verification_analysis_idx on public.action_cards (verification_analysis_id);

create function app_private.verify_outcomes(p_org uuid, p_analysis uuid, p_coverage jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_new text;
begin
  for c in
    select ac.id, ac.check_key, ac.verification,
           (select e.source from public.action_card_evidence ace
              join public.analysis_evidence e on e.id = ace.evidence_id
             where ace.action_card_id = ac.id limit 1) as source
    from public.action_cards ac
    where ac.organization_id = p_org and ac.status in ('done', 'approved') and ac.analysis_id <> p_analysis
  loop
    if coalesce(p_coverage -> c.source ->> 'status', '') not in ('observed', 'measured') then
      continue; -- the source was not checked this time: say nothing
    end if;
    v_new := case when exists (
      select 1 from public.action_cards n where n.analysis_id = p_analysis and n.check_key = c.check_key
    ) then 'still_found' else 'fixed' end;
    update public.action_cards
    set verification = v_new, verified_at = now(), verification_analysis_id = p_analysis
    where id = c.id;
    if v_new is distinct from c.verification then
      perform app_private.log_activity(p_org, 'outcome.' || v_new, 'action_card', c.id::text,
        jsonb_build_object('analysis_id', p_analysis));
    end if;
  end loop;
end $$;
revoke all on function app_private.verify_outcomes(uuid, uuid, jsonb) from public, anon, authenticated;

-- ── analysis functions: same behavior, now also callable by the worker ───────
create or replace function public.start_analysis(p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_website text;
begin
  if not app_private.can_act_for(p_org) or ((select auth.uid()) is null and not app_private.is_service()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
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
  values (p_org, v_website, (select auth.uid())) returning id into v_id;
  perform app_private.log_activity(p_org, 'analysis.started', 'analysis', v_id::text,
    case when app_private.is_service() then '{"scheduled": true}'::jsonb else '{}'::jsonb end);
  return v_id;
end $$;

create or replace function public.complete_analysis(
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
  if v_org is null or not app_private.can_act_for(v_org) then
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

  perform app_private.verify_outcomes(v_org, p_analysis, coalesce(p_coverage, '{}'::jsonb));

  perform app_private.log_activity(v_org, 'analysis.completed', 'analysis', p_analysis::text,
    jsonb_build_object('cards', jsonb_array_length(p_cards), 'evidence', jsonb_array_length(p_evidence)));
end $$;

create or replace function public.fail_analysis(p_analysis uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.analyses where id = p_analysis;
  if v_org is null or not app_private.can_act_for(v_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.analyses set status = 'failed', failure_reason = left(p_reason, 500), completed_at = now()
  where id = p_analysis and status = 'running';
  if found then
    perform app_private.log_activity(v_org, 'analysis.failed', 'analysis', p_analysis::text, '{}'::jsonb);
  end if;
end $$;

grant execute on function public.start_analysis(uuid),
  public.complete_analysis(uuid, jsonb, jsonb, jsonb, text, text),
  public.fail_analysis(uuid, text) to service_role;

-- ── weekly re-analysis ───────────────────────────────────────────────────────
alter table public.organizations add column recurring_analysis boolean not null default true;
grant update (recurring_analysis) on public.organizations to authenticated;

create function public.worker_due_organizations(p_limit int) returns table (
  organization_id uuid, website text, business_name text, service_area text, primary_goal text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_service() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
  select o.id, b.website, b.business_name, b.service_area, b.primary_goal
  from public.organizations o
  join public.business_profiles b on b.organization_id = o.id
  where o.recurring_analysis and b.website is not null
    and not exists (select 1 from public.analyses a where a.organization_id = o.id
                    and (a.status = 'running' or a.started_at > now() - interval '7 days'))
    and exists (select 1 from public.analyses a where a.organization_id = o.id and a.status = 'complete')
  order by (select max(a.started_at) from public.analyses a where a.organization_id = o.id) nulls first
  limit greatest(1, least(p_limit, 20));
end $$;

-- ── notifications ────────────────────────────────────────────────────────────
create table public.notification_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  draft_ready boolean not null default true,
  analysis_complete boolean not null default true,
  updated_at timestamptz not null default now()
);
create trigger notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function app_private.touch_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('draft_ready', 'analysis_complete')),
  channel text not null default 'email' check (channel = 'email'),
  status text not null check (status in ('sent', 'skipped', 'failed')),
  detail text check (detail is null or length(detail) <= 300),
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_org_idx on public.notifications (organization_id);

revoke all on public.notification_preferences, public.notifications from anon, authenticated;
grant select, insert, update (draft_ready, analysis_complete) on public.notification_preferences to authenticated;
grant select on public.notifications to authenticated;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
create policy "Read own preferences" on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Create own preferences" on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Update own preferences" on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Read own notifications" on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

-- People in an organization who want this kind of email. Used by the server to send.
-- Visible to members of that organization (teammates' emails) and to the worker.
create function public.notification_recipients(p_org uuid, p_kind text)
returns table (user_id uuid, email text, full_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.can_act_for(p_org) or p_kind not in ('draft_ready', 'analysis_complete') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
  select m.user_id, u.email::text, p.full_name
  from public.organization_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  left join public.notification_preferences np on np.user_id = m.user_id
  where m.organization_id = p_org and u.email is not null
    and case p_kind when 'draft_ready' then coalesce(np.draft_ready, true) and m.role = 'owner'
                    else coalesce(np.analysis_complete, true) end;
end $$;

create function public.log_notification(p_org uuid, p_user uuid, p_kind text, p_status text, p_detail text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.can_act_for(p_org)
     or not exists (select 1 from public.organization_members where organization_id = p_org and user_id = p_user) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into public.notifications (organization_id, user_id, kind, status, detail)
  values (p_org, p_user, p_kind, p_status, left(p_detail, 300));
end $$;

revoke all on function public.worker_due_organizations(int), public.notification_recipients(uuid, text),
  public.log_notification(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.worker_due_organizations(int) to service_role;
grant execute on function public.notification_recipients(uuid, text), public.log_notification(uuid, uuid, text, text, text)
  to authenticated, service_role;
