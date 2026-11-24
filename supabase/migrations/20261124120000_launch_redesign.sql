-- Launch redesign: free first result, Save this, three free uses, new plans,
-- feedback and funnel counts.
--
-- Additive: new tables, new columns with defaults, new rows, new functions, and
-- replacements of three existing functions (same signatures and checks, plus the new
-- free-use rule) and one widened CHECK constraint. No existing row is deleted; the only
-- write to an existing row sets the new one_time column on the old diagnostic_audit plan.
-- Rollback: supabase/rollback/20261124120000_launch_redesign_down.sql
--
-- * Anonymous visitors never touch tables directly. The web server calls the
--   site_* functions with a dedicated server key (SITE_SERVER_KEY); the database
--   stores only its SHA-256 hash, exactly like the billing key. Holding the public
--   Supabase key is not enough to call them.
-- * A preview result is readable only with its view token (an HTTP-only cookie);
--   only hashes of tokens are stored.
-- * Save this binds a preview to one email address and a single-use claim token
--   (hash stored, 24-hour expiry). claim_preview completes only for a signed-in
--   user whose verified email is that address, so it works from any browser.
-- * Free uses: one completed, saved output = one use (an analysis or a draft).
--   The limit is app_config.free_run_limit (3), enforced in start_analysis and
--   start_agent_run. Failed work does not count.

-- ── configuration ────────────────────────────────────────────────────────────
create table public.app_config (
  key text primary key check (key ~ '^[a-z_]+$'),
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);
revoke all on public.app_config from anon, authenticated;
alter table public.app_config enable row level security;
insert into public.app_config (key, value, description) values
  ('free_run_limit', '3', 'Free uses per account, including the first anonymous result.'),
  ('preview_daily_cap', '200', 'New (uncached) anonymous analyses per 24 hours, all visitors. Spend backstop.'),
  ('preview_ip_daily', '5', 'Anonymous analyses per network address per 24 hours.'),
  ('preview_domain_daily', '3', 'New anonymous analyses of the same website per 24 hours (cached results do not count).'),
  ('feedback_ip_hourly', '10', 'Feedback submissions per network address per hour.');

create function app_private.config_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::int from public.app_config where key = p_key), p_default);
$$;

-- Server key: same pattern as the billing key (only the hash is stored).
create function app_private.site_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from app_private.secrets s where s.name = 'site_server' and s.hash = sha256(convert_to(p_key, 'UTF8'))
  ), false);
$$;

-- ── business ZIP code ────────────────────────────────────────────────────────
alter table public.business_profiles
  add column zip_code text check (zip_code is null or zip_code ~ '^[0-9]{5}$');
grant update (zip_code) on public.business_profiles to authenticated;

-- ── free uses ────────────────────────────────────────────────────────────────
alter table public.analyses add column free_use boolean not null default false;
alter table public.agent_runs add column free_use boolean not null default false;

-- Free uses already taken by this person or this business (running or finished work).
create function app_private.free_uses_used(p_uid uuid, p_org uuid) returns int
language sql stable security definer set search_path = '' as $$
  select (
    (select count(*) from public.analyses a
      where a.free_use and a.status in ('running', 'complete')
        and (a.triggered_by = p_uid or a.organization_id = p_org))
  + (select count(*) from public.agent_runs r
      where r.free_use and r.status in ('running', 'succeeded')
        and (r.started_by = p_uid or r.organization_id = p_org))
  )::int;
$$;

create function public.free_uses(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_used int;
  v_limit int := app_private.config_int('free_run_limit', 3);
begin
  if not app_private.is_org_member(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  v_used := app_private.free_uses_used((select auth.uid()), p_org);
  return jsonb_build_object('used', v_used, 'limit', v_limit, 'remaining', greatest(v_limit - v_used, 0));
end $$;

-- ── plans ────────────────────────────────────────────────────────────────────
-- New plan ids sit beside the old ones (kept so existing references stay valid).
alter table public.plan_entitlements drop constraint plan_entitlements_plan_id_check;
alter table public.plan_entitlements add constraint plan_entitlements_plan_id_check check (plan_id in (
  'diagnostic_audit', 'starter_ai', 'growth_ai', 'scale_automation',
  'marketing_plan', 'single_site', 'business_plus', 'multi_site'));
alter table public.plan_entitlements add column one_time boolean not null default false;
update public.plan_entitlements set one_time = true where plan_id = 'diagnostic_audit';
insert into public.plan_entitlements (plan_id, analyses, weekly, drafts, one_time) values
  ('marketing_plan', true, false, 'none', true),
  ('single_site', true, true, 'all', false),
  ('business_plus', true, true, 'all', false),
  ('multi_site', true, true, 'all', false);

alter table public.subscriptions
  add column billing_interval text check (billing_interval is null or billing_interval in ('month', 'year')),
  add column stripe_price_id text check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$');

-- Best active subscription; otherwise an unused one-time plan; otherwise nothing.
create or replace function app_private.entitlement(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan text;
begin
  select s.plan_id into v_plan from public.subscriptions s
  where s.organization_id = p_org and s.status in ('active', 'trialing')
  order by case s.plan_id
    when 'multi_site' then 1 when 'scale_automation' then 1
    when 'business_plus' then 2 when 'growth_ai' then 2 else 3 end
  limit 1;
  if v_plan is null then
    select p.plan_id into v_plan from public.purchases p
    join public.plan_entitlements e on e.plan_id = p.plan_id and e.one_time
    where p.organization_id = p_org
      and not exists (select 1 from public.analyses a where a.organization_id = p_org and not a.free_use
                      and a.status in ('complete', 'running') and a.started_at >= p.paid_at)
    order by p.paid_at desc limit 1;
  end if;
  if v_plan is null then
    return jsonb_build_object('plan', null, 'analyses', false, 'weekly', false, 'drafts', 'none');
  end if;
  return (select jsonb_build_object('plan', e.plan_id, 'analyses', e.analyses, 'weekly', e.weekly, 'drafts', e.drafts)
          from public.plan_entitlements e where e.plan_id = v_plan);
end $$;

-- Subscription write with interval and price (the old 8-argument version stays for compatibility).
create function public.billing_upsert_subscription(
  p_key text, p_org uuid, p_customer text, p_subscription text, p_plan text, p_status text,
  p_period_end timestamptz, p_cancel_at_period_end boolean, p_interval text, p_price text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.billing_upsert_subscription(p_key, p_org, p_customer, p_subscription, p_plan, p_status,
    p_period_end, p_cancel_at_period_end);
  update public.subscriptions set billing_interval = p_interval, stripe_price_id = p_price
  where stripe_subscription_id = p_subscription;
end $$;
revoke all on function public.billing_upsert_subscription(text, uuid, text, text, text, text, timestamptz, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_upsert_subscription(text, uuid, text, text, text, text, timestamptz, boolean, text, text)
  to anon, authenticated;

-- ── start_analysis / start_agent_run: plan OR a remaining free use ───────────
create or replace function public.start_analysis(p_org uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_website text;
  v_free boolean := false;
  v_uid uuid := (select auth.uid());
begin
  if not app_private.can_act_for(p_org) or (v_uid is null and not app_private.is_service()) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = p_org for update;
  if not coalesce((app_private.entitlement(p_org) ->> (case when app_private.is_service() then 'weekly' else 'analyses' end))::boolean, false) then
    if app_private.is_service()
       or app_private.free_uses_used(v_uid, p_org) >= app_private.config_int('free_run_limit', 3) then
      raise exception 'A plan is needed to run an analysis' using errcode = 'P0001', hint = 'needs_plan';
    end if;
    v_free := true;
  end if;

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

  insert into public.analyses (organization_id, website, triggered_by, free_use)
  values (p_org, v_website, v_uid, v_free) returning id into v_id;
  perform app_private.log_activity(p_org, 'analysis.started', 'analysis', v_id::text,
    case when app_private.is_service() then '{"scheduled": true}'::jsonb
         else jsonb_build_object('free_use', v_free) end);
  return v_id;
end $$;

create or replace function public.start_agent_run(p_card uuid, p_instructions text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_card record;
  v_id uuid;
  v_drafts text;
  v_free boolean := false;
  v_uid uuid := (select auth.uid());
begin
  select id, organization_id, status, ai_capable, execution_type into v_card
  from public.action_cards where id = p_card for update;
  if v_card.id is null or not app_private.is_org_member(v_card.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not v_card.ai_capable or v_card.execution_type = 'manual' then
    raise exception 'This action cannot be prepared by AI' using errcode = 'P0001', hint = 'not_ai_capable';
  end if;
  v_drafts := app_private.entitlement(v_card.organization_id) ->> 'drafts';
  if v_drafts = 'none' or (v_drafts = 'meta' and v_card.execution_type <> 'meta') then
    perform 1 from public.organizations where id = v_card.organization_id for update;
    if app_private.free_uses_used(v_uid, v_card.organization_id) >= app_private.config_int('free_run_limit', 3) then
      raise exception 'Your plan does not include this draft' using errcode = 'P0001', hint = 'needs_plan';
    end if;
    v_free := true;
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

  insert into public.agent_runs (organization_id, action_card_id, draft_type, instructions, started_by, free_use)
  values (v_card.organization_id, p_card, v_card.execution_type,
          nullif(left(btrim(coalesce(p_instructions, '')), 1000), ''), v_uid, v_free)
  returning id into v_id;
  update public.action_cards set status = 'in_progress' where id = p_card and status = 'new';
  perform app_private.log_activity(v_card.organization_id, 'agent_run.started', 'agent_run', v_id::text,
    jsonb_build_object('draft_type', v_card.execution_type, 'action_card_id', p_card, 'free_use', v_free));
  return v_id;
end $$;

-- ── anonymous previews ───────────────────────────────────────────────────────
create table public.previews (
  id uuid primary key default gen_random_uuid(),
  website text not null check (length(website) <= 300),
  domain text not null check (length(domain) <= 255),
  zip_code text not null check (zip_code ~ '^[0-9]{5}$'),
  ip_hash text not null check (length(ip_hash) = 64),
  view_token_hash bytea not null,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  cached_from uuid references public.previews (id) on delete set null,
  evidence jsonb,
  cards jsonb,
  coverage jsonb,
  summary text check (summary is null or length(summary) <= 2000),
  wording text check (wording is null or wording in ('ai', 'template')),
  failure_reason text check (failure_reason is null or length(failure_reason) <= 500),
  email text check (email is null or (length(email) <= 254 and email = lower(email))),
  claim_token_hash bytea unique,
  claim_expires_at timestamptz,
  save_requests int not null default 0,
  claimed_by uuid references auth.users (id) on delete set null,
  claimed_at timestamptz,
  claimed_analysis_id uuid references public.analyses (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index previews_domain_idx on public.previews (domain, created_at desc);
create index previews_ip_idx on public.previews (ip_hash, created_at desc);
create index previews_created_idx on public.previews (created_at);
create index previews_claimed_by_idx on public.previews (claimed_by);
create index previews_cached_from_idx on public.previews (cached_from);
create index previews_claimed_analysis_idx on public.previews (claimed_analysis_id);
revoke all on public.previews from anon, authenticated;
alter table public.previews enable row level security;
-- No policies: only the functions below read or write previews.

create function app_private.preview_view_ok(p_id uuid, p_view text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.previews p where p.id = p_id
                 and p.view_token_hash = sha256(convert_to(coalesce(p_view, ''), 'UTF8')));
$$;

-- Starts a preview. Returns {id, cached}. When the same website was analyzed in the
-- last 24 hours, the result is copied (no new spend).
create function public.site_preview_start(
  p_key text, p_website text, p_domain text, p_zip text, p_ip_hash text, p_view text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_cache record;
begin
  if not app_private.site_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if length(coalesce(p_view, '')) < 32 then
    raise exception 'Invalid token' using errcode = '22023';
  end if;
  -- Seven-day cleanup (claimed results were already copied into the account).
  delete from public.previews where created_at < now() - interval '7 days';

  if (select count(*) from public.previews
      where ip_hash = p_ip_hash and created_at > now() - interval '1 day') >= app_private.config_int('preview_ip_daily', 5) then
    raise exception 'Too many from this address' using errcode = 'P0001', hint = 'ip_limit';
  end if;

  select * into v_cache from public.previews
  where domain = lower(p_domain) and status = 'complete' and cached_from is null
    and completed_at > now() - interval '24 hours'
  order by completed_at desc limit 1;
  if v_cache.id is not null then
    insert into public.previews (website, domain, zip_code, ip_hash, view_token_hash, status, cached_from,
      evidence, cards, coverage, summary, wording, completed_at)
    values (p_website, lower(p_domain), p_zip, p_ip_hash, sha256(convert_to(p_view, 'UTF8')), 'complete', v_cache.id,
      v_cache.evidence, v_cache.cards, v_cache.coverage, v_cache.summary, v_cache.wording, now())
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'cached', true);
  end if;

  if (select count(*) from public.previews
      where domain = lower(p_domain) and cached_from is null and created_at > now() - interval '1 day')
     >= app_private.config_int('preview_domain_daily', 3) then
    raise exception 'Too many for this website' using errcode = 'P0001', hint = 'domain_limit';
  end if;
  if (select count(*) from public.previews where cached_from is null and created_at > now() - interval '1 day')
     >= app_private.config_int('preview_daily_cap', 200) then
    raise exception 'Daily capacity reached' using errcode = 'P0001', hint = 'busy';
  end if;

  insert into public.previews (website, domain, zip_code, ip_hash, view_token_hash)
  values (p_website, lower(p_domain), p_zip, p_ip_hash, sha256(convert_to(p_view, 'UTF8')))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'cached', false);
end $$;

create function public.site_preview_complete(
  p_key text, p_id uuid, p_evidence jsonb, p_cards jsonb, p_coverage jsonb, p_summary text, p_wording text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.site_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_typeof(p_cards) <> 'array'
     or jsonb_array_length(p_evidence) > 200 or jsonb_array_length(p_cards) > 30 then
    raise exception 'Invalid analysis payload' using errcode = '22023';
  end if;
  update public.previews
  set status = 'complete', evidence = p_evidence, cards = p_cards, coverage = coalesce(p_coverage, '{}'::jsonb),
      summary = left(p_summary, 2000), wording = p_wording, completed_at = now()
  where id = p_id and status = 'running';
end $$;

create function public.site_preview_fail(p_key text, p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.site_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.previews set status = 'failed', failure_reason = left(p_reason, 500), completed_at = now()
  where id = p_id and status = 'running';
end $$;

-- The visitor's own preview (view token required). Never returns email or tokens.
create function public.site_preview_get(p_key text, p_id uuid, p_view text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  if not app_private.site_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.previews set status = 'failed', failure_reason = 'This took too long. Please try again.', completed_at = now()
  where id = p_id and status = 'running' and created_at < now() - interval '5 minutes';
  select jsonb_build_object('id', p.id, 'website', p.website, 'domain', p.domain, 'zip_code', p.zip_code,
    'status', p.status, 'evidence', p.evidence, 'cards', p.cards, 'coverage', p.coverage, 'summary', p.summary,
    'failure_reason', p.failure_reason, 'saved', p.email is not null, 'claimed', p.claimed_at is not null,
    'created_at', p.created_at, 'completed_at', p.completed_at)
  into v from public.previews p
  where p.id = p_id and p.view_token_hash = sha256(convert_to(coalesce(p_view, ''), 'UTF8'));
  return v;
end $$;

-- Save this: binds the preview to an email and a single-use claim token (24 hours).
-- Asking again replaces the earlier token, so only the latest email link works.
create function public.site_preview_save(p_key text, p_id uuid, p_view text, p_email text, p_claim text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v record;
begin
  if not app_private.site_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if length(coalesce(p_claim, '')) < 32 or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 254 then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  select id, status, claimed_at, save_requests into v from public.previews
  where id = p_id and view_token_hash = sha256(convert_to(coalesce(p_view, ''), 'UTF8')) for update;
  if v.id is null then
    raise exception 'Not found' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v.status <> 'complete' or v.claimed_at is not null then
    raise exception 'Not available' using errcode = 'P0001', hint = 'not_available';
  end if;
  if v.save_requests >= 5 then
    raise exception 'Too many requests' using errcode = 'P0001', hint = 'save_limit';
  end if;
  update public.previews
  set email = lower(btrim(p_email)), claim_token_hash = sha256(convert_to(p_claim, 'UTF8')),
      claim_expires_at = now() + interval '24 hours', save_requests = save_requests + 1
  where id = p_id;
end $$;

-- Copies a preview's evidence and cards into an organization as a completed analysis.
create function app_private.copy_preview_into(p_preview uuid, p_org uuid, p_uid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  p record;
  v_analysis uuid;
  v_ev jsonb;
  v_card jsonb;
  v_key text;
  v_keys jsonb := '{}'::jsonb;
  v_ev_id uuid;
  v_card_id uuid;
begin
  select * into p from public.previews where id = p_preview;
  insert into public.analyses (organization_id, website, triggered_by, free_use, status, source_coverage, summary, wording,
                               started_at, completed_at)
  values (p_org, p.website, p_uid, true, 'complete', coalesce(p.coverage, '{}'::jsonb), p.summary, p.wording,
          coalesce(p.created_at, now()), coalesce(p.completed_at, now()))
  returning id into v_analysis;
  for v_ev in select * from jsonb_array_elements(coalesce(p.evidence, '[]'::jsonb)) loop
    insert into public.analysis_evidence
      (analysis_id, organization_id, source, kind, check_key, url, observation, excerpt, measurement, observed_at)
    values (v_analysis, p_org, v_ev ->> 'source', v_ev ->> 'kind', v_ev ->> 'check_key',
            v_ev ->> 'url', v_ev ->> 'observation', v_ev ->> 'excerpt', v_ev -> 'measurement', coalesce(p.completed_at, now()))
    returning id into v_ev_id;
    v_keys := v_keys || jsonb_build_object(v_ev ->> 'key', v_ev_id);
  end loop;
  for v_card in select * from jsonb_array_elements(coalesce(p.cards, '[]'::jsonb)) loop
    insert into public.action_cards (
      organization_id, analysis_id, check_key, title, explanation, why_it_matters, recommended_action,
      expected_benefit, impact_priority, confidence, ai_capable, execution_type, approval_required, wording)
    values (
      p_org, v_analysis, v_card ->> 'check_key', v_card ->> 'title', v_card ->> 'explanation',
      v_card ->> 'why_it_matters', v_card ->> 'recommended_action', v_card ->> 'expected_benefit',
      v_card ->> 'impact_priority', v_card ->> 'confidence',
      coalesce((v_card ->> 'ai_capable')::boolean, false), coalesce(v_card ->> 'execution_type', 'manual'),
      coalesce((v_card ->> 'approval_required')::boolean, true), coalesce(p.wording, 'template'))
    returning id into v_card_id;
    for v_key in select jsonb_array_elements_text(coalesce(v_card -> 'evidence_keys', '[]'::jsonb)) loop
      if v_keys ? v_key then
        insert into public.action_card_evidence (action_card_id, evidence_id, organization_id)
        values (v_card_id, (v_keys ->> v_key)::uuid, p_org) on conflict do nothing;
      end if;
    end loop;
  end loop;
  insert into public.data_connections (organization_id, provider, status, last_synced_at, sync_status)
  values (p_org, 'website', 'connected', now(), 'ok')
  on conflict (organization_id, provider) do update
    set status = 'connected', last_synced_at = now(), sync_status = 'ok', last_error = null;
  perform app_private.log_activity(p_org, 'analysis.completed', 'analysis', v_analysis::text,
    jsonb_build_object('cards', jsonb_array_length(coalesce(p.cards, '[]'::jsonb)), 'from_preview', true));
  return v_analysis;
end $$;

-- Claims a saved preview for the signed-in user. Requires the claim token from the
-- email link AND that the user's verified email is the address the preview was saved
-- with. Single use; expired, replayed or mismatched claims are refused.
-- Returns {organization_id, analysis_id}.
create function public.claim_preview(p_claim text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  p record;
  v_org uuid;
  v_org_site text;
  v_analysis uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Email not verified' using errcode = 'P0001', hint = 'unverified';
  end if;
  select * into p from public.previews
  where claim_token_hash = sha256(convert_to(coalesce(p_claim, ''), 'UTF8')) for update;
  if p.id is null or p.claimed_at is not null then
    raise exception 'Link already used or not found' using errcode = 'P0001', hint = 'invalid';
  end if;
  if p.claim_expires_at < now() then
    raise exception 'Link expired' using errcode = 'P0001', hint = 'expired';
  end if;
  if p.email is distinct from v_email then
    raise exception 'Different email' using errcode = 'P0001', hint = 'wrong_email';
  end if;

  -- The person's first business they own; created from the preview if they have none.
  select m.organization_id, b.website into v_org, v_org_site
  from public.organization_members m
  join public.business_profiles b on b.organization_id = m.organization_id
  where m.user_id = v_uid and m.role = 'owner' order by m.created_at limit 1;
  if v_org is null then
    insert into public.organizations (name, created_by) values (p.domain, v_uid) returning id into v_org;
    insert into public.organization_members (organization_id, user_id, role) values (v_org, v_uid, 'owner');
    insert into public.business_profiles (organization_id, business_name, website, zip_code)
    values (v_org, p.domain, p.website, p.zip_code);
    perform app_private.log_activity(v_org, 'organization.created', 'organization', v_org::text, '{"from_preview": true}'::jsonb);
  elsif v_org_site is null then
    update public.business_profiles set website = p.website, zip_code = coalesce(zip_code, p.zip_code)
    where organization_id = v_org;
  elsif lower(regexp_replace(v_org_site, '^https?://(www\.)?([^/:]+).*$', '\2'))
        <> regexp_replace(p.domain, '^www\.', '') then
    raise exception 'Account has another website' using errcode = 'P0001', hint = 'other_site';
  end if;

  v_analysis := app_private.copy_preview_into(p.id, v_org, v_uid);
  update public.previews
  set claimed_by = v_uid, claimed_at = now(), claimed_analysis_id = v_analysis, claim_token_hash = null
  where id = p.id;
  perform app_private.log_activity(v_org, 'preview.claimed', 'analysis', v_analysis::text, '{}'::jsonb);
  return jsonb_build_object('organization_id', v_org, 'analysis_id', v_analysis);
end $$;

-- ── feedback (insert-only, through the server) ───────────────────────────────
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('first_result', 'upgrade')),
  rating text check (rating is null or rating in ('up', 'down')),
  reason text check (reason is null or length(reason) <= 500),
  preview_id uuid references public.previews (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  ip_hash text not null check (length(ip_hash) = 64),
  created_at timestamptz not null default now(),
  check (rating is not null or reason is not null)
);
create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_ip_idx on public.feedback (ip_hash, created_at desc);
create index feedback_preview_idx on public.feedback (preview_id);
create index feedback_org_idx on public.feedback (organization_id);

-- Follow-up permission is stored apart from the feedback itself.
create table public.feedback_followups (
  feedback_id uuid primary key references public.feedback (id) on delete cascade,
  email text not null check (length(email) <= 254 and email = lower(email)),
  created_at timestamptz not null default now()
);

revoke all on public.feedback, public.feedback_followups from anon, authenticated;
alter table public.feedback enable row level security;
alter table public.feedback_followups enable row level security;

create function public.site_submit_feedback(
  p_key text, p_kind text, p_rating text, p_reason text, p_preview uuid, p_org uuid, p_ip_hash text, p_followup_email text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not app_private.site_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if (select count(*) from public.feedback where ip_hash = p_ip_hash and created_at > now() - interval '1 hour')
     >= app_private.config_int('feedback_ip_hourly', 10) then
    raise exception 'Too many' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  insert into public.feedback (kind, rating, reason, preview_id, organization_id, ip_hash)
  values (p_kind, p_rating, nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
          (select id from public.previews where id = p_preview),
          (select id from public.organizations where id = p_org), p_ip_hash)
  returning id into v_id;
  if nullif(btrim(coalesce(p_followup_email, '')), '') is not null then
    insert into public.feedback_followups (feedback_id, email) values (v_id, lower(btrim(p_followup_email)));
  end if;
end $$;

-- ── funnel counts (insert-only, no personal data) ────────────────────────────
create table public.funnel_events (
  id bigint generated always as identity primary key,
  event text not null check (event in (
    'homepage_visit', 'first_use_started', 'first_result_completed', 'save_this_clicked', 'signup_started',
    'signup_completed', 'free_use_consumed', 'upgrade_viewed', 'checkout_started', 'subscription_completed',
    'purchase_completed', 'draft_created', 'draft_approved', 'work_completed', 'reanalysis_completed',
    'feedback_submitted')),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 512 and props::text !~ '@'),
  created_at timestamptz not null default now()
);
create index funnel_events_created_idx on public.funnel_events (created_at desc, event);
revoke all on public.funnel_events from anon, authenticated;
alter table public.funnel_events enable row level security;

create function public.site_track(p_key text, p_event text, p_props jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.site_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into public.funnel_events (event, props) values (p_event, coalesce(p_props, '{}'::jsonb));
end $$;

-- Admin-only funnel and feedback view. Every call is logged.
create function public.admin_funnel(p_days int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
begin
  if not app_private.is_platform_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform app_private.log_activity(null, 'admin.funnel_viewed', null, null, '{}'::jsonb);
  return jsonb_build_object(
    'since', v_since,
    'events', coalesce((select jsonb_object_agg(event, n) from (
      select event, count(*) n from public.funnel_events where created_at >= v_since group by event) t), '{}'::jsonb),
    'free_uses', (select count(*) from public.analyses where free_use and status = 'complete' and created_at >= v_since)
               + (select count(*) from public.agent_runs where free_use and status = 'succeeded' and started_at >= v_since),
    'previews', jsonb_build_object(
      'started', (select count(*) from public.previews where created_at >= v_since),
      'completed', (select count(*) from public.previews where status = 'complete' and created_at >= v_since),
      'saved', (select count(*) from public.previews where email is not null and created_at >= v_since),
      'claimed', (select count(*) from public.previews where claimed_at is not null and created_at >= v_since)),
    'purchases', (select count(*) from public.purchases where paid_at >= v_since),
    'subscriptions', (select count(*) from public.subscriptions where created_at >= v_since),
    'feedback', coalesce((select jsonb_agg(f) from (
      select fb.id, fb.kind, fb.rating, fb.reason, fb.created_at, fu.email as followup_email
      from public.feedback fb left join public.feedback_followups fu on fu.feedback_id = fb.id
      where fb.created_at >= v_since order by fb.created_at desc limit 200) f), '[]'::jsonb),
    'ratings', jsonb_build_object(
      'up', (select count(*) from public.feedback where rating = 'up' and created_at >= v_since),
      'down', (select count(*) from public.feedback where rating = 'down' and created_at >= v_since))
  );
end $$;

-- ── privileges ───────────────────────────────────────────────────────────────
revoke all on function app_private.config_int(text, int), app_private.site_key_ok(text),
  app_private.free_uses_used(uuid, uuid), app_private.preview_view_ok(uuid, text),
  app_private.copy_preview_into(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.free_uses(uuid), public.claim_preview(text), public.admin_funnel(int),
  public.site_preview_start(text, text, text, text, text, text),
  public.site_preview_complete(text, uuid, jsonb, jsonb, jsonb, text, text),
  public.site_preview_fail(text, uuid, text), public.site_preview_get(text, uuid, text),
  public.site_preview_save(text, uuid, text, text, text),
  public.site_submit_feedback(text, text, text, text, uuid, uuid, text, text),
  public.site_track(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.free_uses(uuid), public.claim_preview(text), public.admin_funnel(int) to authenticated;
-- The site_* functions refuse callers without the server key.
grant execute on function public.site_preview_start(text, text, text, text, text, text),
  public.site_preview_complete(text, uuid, jsonb, jsonb, jsonb, text, text),
  public.site_preview_fail(text, uuid, text), public.site_preview_get(text, uuid, text),
  public.site_preview_save(text, uuid, text, text, text),
  public.site_submit_feedback(text, text, text, text, uuid, uuid, text, text),
  public.site_track(text, text, jsonb)
  to anon, authenticated;
