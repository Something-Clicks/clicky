-- Rollback for 20261126120000_marketing_workflow.sql. Run by hand only.
-- Data removed: every marketing_workflows row, and the origin/stage/completion_basis columns
-- (stage and completion_basis are derived, so nothing is lost there; origin is 'website_check'
-- for every card today). Cards approved with approve_action_card keep status 'approved',
-- a status that existed before this migration; activity_log rows are kept.
begin;

drop function if exists public.approve_action_card(uuid, text);
drop function if exists public.finish_marketing_workflow(uuid, text, jsonb, jsonb, text, text, text, jsonb);
drop function if exists public.start_marketing_workflow(uuid, text, text, text[], uuid);
drop table if exists public.marketing_workflows;

drop index if exists public.action_cards_stage_idx;
alter table public.action_cards
  drop column if exists completion_basis,
  drop column if exists stage,
  drop column if exists origin;

commit;
