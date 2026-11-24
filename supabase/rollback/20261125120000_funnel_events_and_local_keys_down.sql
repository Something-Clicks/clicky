-- Rollback for 20261125120000_funnel_events_and_local_keys.sql. Run by hand only.
-- Data removed: funnel rows with the five new step names, and any *_local key rows.
begin;

delete from public.funnel_events
where event in ('website_submitted', 'sign_in', 'return_visit', 'limit_reached', 'pricing_viewed');
alter table public.funnel_events drop constraint funnel_events_event_check;
alter table public.funnel_events add constraint funnel_events_event_check check (event in (
  'homepage_visit', 'first_use_started', 'first_result_completed', 'save_this_clicked', 'signup_started',
  'signup_completed', 'free_use_consumed', 'upgrade_viewed', 'checkout_started', 'subscription_completed',
  'purchase_completed', 'draft_created', 'draft_approved', 'work_completed', 'reanalysis_completed',
  'feedback_submitted'));

delete from app_private.secrets where name in ('site_server_local', 'billing_webhook_local');

create or replace function app_private.site_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from app_private.secrets s where s.name = 'site_server' and s.hash = sha256(convert_to(p_key, 'UTF8'))
  ), false);
$$;

create or replace function app_private.billing_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from app_private.secrets s where s.name = 'billing_webhook' and s.hash = sha256(convert_to(p_key, 'UTF8'))
  ), false);
$$;

commit;
