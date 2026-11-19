-- A verified webhook with a different Stripe customer (e.g. the old one was deleted in
-- Stripe and checkout created a new one) replaces the saved customer for the business.
create or replace function app_private.link_customer(p_org uuid, p_customer text) returns void
language sql security definer set search_path = '' as $$
  insert into public.billing_customers (organization_id, stripe_customer_id) values (p_org, p_customer)
  on conflict (organization_id) do update set stripe_customer_id = excluded.stripe_customer_id;
$$;
