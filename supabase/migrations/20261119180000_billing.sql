-- Phase 6: payments and entitlements (Stripe, test mode first).
--
-- * Paid access comes ONLY from verified Stripe webhooks. The webhook route calls the
--   billing_* functions with a dedicated billing key; the database stores only its
--   SHA-256 hash and the key can do nothing else (least privilege).
-- * Every Stripe event is recorded once (provider + event id unique) for idempotency.
-- * Entitlements are enforced here, in start_analysis / start_agent_run / the weekly
--   worker, so calling the API directly cannot skip payment.
-- * Prices live in src/config/pricing.ts; what each plan unlocks lives in plan_entitlements.

create table app_private.secrets (
  name text primary key,
  hash bytea not null,
  created_at timestamptz not null default now()
);
revoke all on app_private.secrets from public, anon, authenticated;

create function app_private.billing_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from app_private.secrets s where s.name = 'billing_webhook' and s.hash = sha256(convert_to(p_key, 'UTF8'))
  ), false);
$$;

create table public.plan_entitlements (
  plan_id text primary key check (plan_id in ('diagnostic_audit', 'starter_ai', 'growth_ai', 'scale_automation')),
  analyses boolean not null,
  weekly boolean not null,
  drafts text not null check (drafts in ('none', 'meta', 'all'))
);
insert into public.plan_entitlements values
  ('diagnostic_audit', true, false, 'none'),
  ('starter_ai', true, true, 'meta'),
  ('growth_ai', true, true, 'all'),
  ('scale_automation', true, true, 'all');
revoke all on public.plan_entitlements from anon, authenticated;
grant select on public.plan_entitlements to anon, authenticated;
alter table public.plan_entitlements enable row level security;
create policy "Anyone reads plan entitlements" on public.plan_entitlements for select to anon, authenticated using (true);

create table public.billing_customers (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  plan_id text not null references public.plan_entitlements (plan_id),
  status text not null check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index subscriptions_org_idx on public.subscriptions (organization_id, status);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plan_id text not null references public.plan_entitlements (plan_id),
  stripe_checkout_session_id text not null unique check (stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  amount_cents int not null check (amount_cents > 0),
  paid_at timestamptz not null default now()
);
create index purchases_org_idx on public.purchases (organization_id);

create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'stripe'),
  event_id text not null check (length(event_id) between 3 and 255),
  type text not null check (length(type) <= 100),
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text check (error is null or length(error) <= 500),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

revoke all on public.billing_customers, public.subscriptions, public.purchases, public.integration_events from anon, authenticated;
grant select on public.subscriptions, public.purchases to authenticated;
alter table public.billing_customers enable row level security;
alter table public.subscriptions enable row level security;
alter table public.purchases enable row level security;
alter table public.integration_events enable row level security;
create policy "Members read subscriptions" on public.subscriptions for select to authenticated
  using (app_private.is_org_member(organization_id));
create policy "Members read purchases" on public.purchases for select to authenticated
  using (app_private.is_org_member(organization_id));

-- ── entitlements ─────────────────────────────────────────────────────────────
-- The best active subscription's plan; otherwise an unused Diagnostic Audit; otherwise nothing.
create function app_private.entitlement(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan text;
begin
  select s.plan_id into v_plan from public.subscriptions s
  where s.organization_id = p_org and s.status in ('active', 'trialing')
  order by case s.plan_id when 'scale_automation' then 1 when 'growth_ai' then 2 else 3 end limit 1;
  if v_plan is null and exists (
    select 1 from public.purchases p where p.organization_id = p_org and p.plan_id = 'diagnostic_audit'
      and not exists (select 1 from public.analyses a where a.organization_id = p_org
                      and a.status in ('complete', 'running') and a.started_at >= p.paid_at)
  ) then
    v_plan := 'diagnostic_audit';
  end if;
  if v_plan is null then
    return jsonb_build_object('plan', null, 'analyses', false, 'weekly', false, 'drafts', 'none');
  end if;
  return (select jsonb_build_object('plan', e.plan_id, 'analyses', e.analyses, 'weekly', e.weekly, 'drafts', e.drafts)
          from public.plan_entitlements e where e.plan_id = v_plan);
end $$;

create function public.current_entitlements(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_org_member(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return app_private.entitlement(p_org);
end $$;

-- Owner only: the business's Stripe customer id (to reuse in Checkout and open the portal).
create function public.billing_customer_id(p_org uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.has_org_role(p_org, 'owner') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return (select stripe_customer_id from public.billing_customers where organization_id = p_org);
end $$;

-- ── webhook-only functions (billing key required) ────────────────────────────
create function public.billing_record_event(p_key text, p_event_id text, p_type text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if not app_private.billing_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into public.integration_events (provider, event_id, type) values ('stripe', p_event_id, left(p_type, 100))
  on conflict (provider, event_id) do nothing;
  if found then return 'new'; end if;
  select status into v_status from public.integration_events where provider = 'stripe' and event_id = p_event_id;
  if v_status = 'failed' then
    update public.integration_events set status = 'received', error = null where provider = 'stripe' and event_id = p_event_id;
    return 'retry';
  end if;
  return 'duplicate';
end $$;

create function public.billing_finish_event(p_key text, p_event_id text, p_status text, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.billing_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.integration_events set status = p_status, error = left(p_error, 500), processed_at = now()
  where provider = 'stripe' and event_id = p_event_id;
end $$;

create function app_private.link_customer(p_org uuid, p_customer text) returns void
language sql security definer set search_path = '' as $$
  insert into public.billing_customers (organization_id, stripe_customer_id) values (p_org, p_customer)
  on conflict (organization_id) do nothing;
$$;

create function public.billing_record_purchase(
  p_key text, p_org uuid, p_plan text, p_session text, p_customer text, p_amount int
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.billing_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_customer is not null then perform app_private.link_customer(p_org, p_customer); end if;
  insert into public.purchases (organization_id, plan_id, stripe_checkout_session_id, amount_cents)
  values (p_org, p_plan, p_session, p_amount) on conflict (stripe_checkout_session_id) do nothing;
  if found then
    perform app_private.log_activity(p_org, 'billing.purchase_confirmed', 'purchase', p_session,
      jsonb_build_object('plan', p_plan, 'amount_cents', p_amount));
  end if;
end $$;

create function public.billing_upsert_subscription(
  p_key text, p_org uuid, p_customer text, p_subscription text, p_plan text, p_status text,
  p_period_end timestamptz, p_cancel_at_period_end boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  if not app_private.billing_key_ok(p_key) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_customer is not null then perform app_private.link_customer(p_org, p_customer); end if;
  select status into v_old from public.subscriptions where stripe_subscription_id = p_subscription;
  insert into public.subscriptions (organization_id, stripe_subscription_id, plan_id, status, current_period_end, cancel_at_period_end)
  values (p_org, p_subscription, p_plan, p_status, p_period_end, coalesce(p_cancel_at_period_end, false))
  on conflict (stripe_subscription_id) do update
    set plan_id = excluded.plan_id, status = excluded.status, current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end, updated_at = now();
  if v_old is distinct from p_status then
    perform app_private.log_activity(p_org, 'billing.subscription_' || p_status, 'subscription', p_subscription,
      jsonb_build_object('plan', p_plan));
  end if;
end $$;

revoke all on function app_private.billing_key_ok(text), app_private.entitlement(uuid), app_private.link_customer(uuid, text)
  from public, anon, authenticated;
revoke all on function public.current_entitlements(uuid), public.billing_customer_id(uuid),
  public.billing_record_event(text, text, text), public.billing_finish_event(text, text, text, text),
  public.billing_record_purchase(text, uuid, text, text, text, int),
  public.billing_upsert_subscription(text, uuid, text, text, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.current_entitlements(uuid), public.billing_customer_id(uuid) to authenticated;
grant execute on function public.billing_record_event(text, text, text), public.billing_finish_event(text, text, text, text),
  public.billing_record_purchase(text, uuid, text, text, text, int),
  public.billing_upsert_subscription(text, uuid, text, text, text, text, timestamptz, boolean)
  to anon, authenticated;

-- ── enforce entitlements where work starts ───────────────────────────────────
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
  if not coalesce((app_private.entitlement(p_org) ->> (case when app_private.is_service() then 'weekly' else 'analyses' end))::boolean, false) then
    raise exception 'A plan is needed to run an analysis' using errcode = 'P0001', hint = 'needs_plan';
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

  insert into public.analyses (organization_id, website, triggered_by)
  values (p_org, v_website, (select auth.uid())) returning id into v_id;
  perform app_private.log_activity(p_org, 'analysis.started', 'analysis', v_id::text,
    case when app_private.is_service() then '{"scheduled": true}'::jsonb else '{}'::jsonb end);
  return v_id;
end $$;

create or replace function public.start_agent_run(p_card uuid, p_instructions text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_card record;
  v_id uuid;
  v_drafts text;
begin
  select id, organization_id, status, ai_capable, execution_type into v_card
  from public.action_cards where id = p_card for update;
  if v_card.id is null or not app_private.is_org_member(v_card.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  v_drafts := app_private.entitlement(v_card.organization_id) ->> 'drafts';
  if v_drafts = 'none' or (v_drafts = 'meta' and v_card.execution_type <> 'meta') then
    raise exception 'Your plan does not include this draft' using errcode = 'P0001', hint = 'needs_plan';
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

create or replace function public.worker_due_organizations(p_limit int) returns table (
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
    and coalesce((app_private.entitlement(o.id) ->> 'weekly')::boolean, false)
    and not exists (select 1 from public.analyses a where a.organization_id = o.id
                    and (a.status = 'running' or a.started_at > now() - interval '7 days'))
    and exists (select 1 from public.analyses a where a.organization_id = o.id and a.status = 'complete')
  order by (select max(a.started_at) from public.analyses a where a.organization_id = o.id) nulls first
  limit greatest(1, least(p_limit, 20));
end $$;
