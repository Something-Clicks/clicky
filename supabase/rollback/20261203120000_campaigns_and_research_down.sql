-- Rollback for 20261203120000_campaigns_and_research.sql. Run by hand only. Drops campaigns, tasks and competitor scans (data is lost).
begin;
drop function if exists public.set_task_status(uuid, text, text);
drop function if exists public.edit_task_deliverable(uuid, text);
drop function if exists public.decide_campaign(uuid, text);
drop function if exists public.save_campaign(uuid, jsonb);
drop function if exists public.remove_competitor_scan(uuid);
drop function if exists public.save_competitor_scan(uuid, text, text, text, jsonb, text, boolean);
drop table if exists public.campaign_tasks;
drop table if exists public.marketing_campaigns;
drop table if exists public.competitor_scans;
commit;
