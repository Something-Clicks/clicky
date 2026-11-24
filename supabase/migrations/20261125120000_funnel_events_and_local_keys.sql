-- More funnel steps, and separate keys for local testing.
--
-- Additive and reversible (rollback: supabase/rollback/20261125120000_funnel_events_and_local_keys_down.sql).
--
-- 1. funnel_events accepts five more step names (website_submitted, sign_in, return_visit,
--    limit_reached, pricing_viewed). Counts only; the no-"@" rule on props stays.
-- 2. The server-key checks also accept an optional second key per purpose, stored under the names
--    'site_server_local' and 'billing_webhook_local'. A developer's own machine can then run the app
--    against this project with its own keys WITHOUT replacing the keys the deployed Preview uses.
--    Nothing changes unless such a row exists; production has none.

create or replace function app_private.site_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from app_private.secrets s
    where s.name in ('site_server', 'site_server_local') and s.hash = sha256(convert_to(p_key, 'UTF8'))
  ), false);
$$;

create or replace function app_private.billing_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(p_key) >= 32 and exists (
    select 1 from app_private.secrets s
    where s.name in ('billing_webhook', 'billing_webhook_local') and s.hash = sha256(convert_to(p_key, 'UTF8'))
  ), false);
$$;

alter table public.funnel_events drop constraint funnel_events_event_check;
alter table public.funnel_events add constraint funnel_events_event_check check (event in (
  'homepage_visit', 'first_use_started', 'first_result_completed', 'save_this_clicked', 'signup_started',
  'signup_completed', 'free_use_consumed', 'upgrade_viewed', 'checkout_started', 'subscription_completed',
  'purchase_completed', 'draft_created', 'draft_approved', 'work_completed', 'reanalysis_completed',
  'feedback_submitted',
  'website_submitted', 'sign_in', 'return_visit', 'limit_reached', 'pricing_viewed'));
