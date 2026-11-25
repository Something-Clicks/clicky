-- Rollback for 20261129120000_model_usage_and_strategy.sql. Run by hand only, newest first.
-- Data removed: model_usage, organization_model_limits, marketing_plans, the three model cap settings, and
-- business facts that use the three new fields (positioning, trust_signal, price_positioning).
-- business_fact_field_ok is restored to its original body.
begin;

drop function if exists public.admin_agent_review(integer);
drop function if exists public.decide_marketing_plan(uuid, text);
drop function if exists public.save_marketing_plan(uuid, uuid, jsonb, text, text);
drop table if exists public.marketing_plans;
drop function if exists public.admin_model_usage(integer);
drop function if exists public.record_model_usage(uuid, text, text, text, integer, integer, bigint, text, uuid, uuid);
drop function if exists public.model_budget(uuid);
drop function if exists app_private.config_bigint(text, bigint);
drop table if exists public.organization_model_limits;
drop table if exists public.model_usage;
delete from public.app_config where key in ('model_daily_cap_micro', 'model_monthly_cap_micro', 'model_global_daily_cap_micro');

delete from public.business_facts where field in ('positioning', 'trust_signal', 'price_positioning');
-- Original business_fact_field_ok (20261127120000_business_intelligence_evidence.sql), restored exactly.
create or replace function app_private.business_fact_field_ok(p_category text, p_field text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_category
    when 'business' then p_field in ('what_it_does', 'industry', 'business_model', 'service', 'product', 'service_area',
      'location', 'contact_phone', 'contact_email', 'pricing', 'competitive_advantage', 'goal', 'marketing_objective', 'constraint')
    when 'brand' then p_field in ('voice', 'tone', 'value_proposition', 'key_message', 'preferred_term', 'avoid_term', 'brand_guideline')
    when 'customer' then p_field in ('audience', 'customer_problem', 'motivation', 'objection', 'customer_question', 'decision_factor')
    else false
  end;
$$;

commit;
