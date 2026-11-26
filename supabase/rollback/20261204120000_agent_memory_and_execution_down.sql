-- Rollback for 20261204120000_agent_memory_and_execution.sql. Run by hand only.
-- Drops the research library, performance history and execution records (data is lost) and the card effort/dependency columns.
begin;
drop function if exists public.annotate_action_cards(uuid, jsonb);
drop trigger if exists action_cards_verify_execution on public.action_cards;
drop function if exists app_private.verify_execution_records();
drop function if exists public.cancel_execution(uuid);
drop function if exists public.execute_authorized(uuid);
drop function if exists public.authorize_execution(uuid);
drop function if exists public.request_execution(uuid, text, uuid, uuid, text, text);
drop function if exists public.remove_performance_metric(uuid);
drop function if exists public.record_performance_metrics(uuid, text, jsonb);
drop function if exists public.remove_research_item(uuid);
drop function if exists public.import_research_items(uuid, text, date, jsonb);
drop table if exists public.execution_records;
drop table if exists public.performance_metrics;
drop table if exists public.research_items;
alter table public.action_cards drop column if exists depends_on, drop column if exists effort;
commit;
