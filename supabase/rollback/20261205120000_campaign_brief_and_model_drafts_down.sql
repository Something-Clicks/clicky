-- Rollback for 20261205120000_campaign_brief_and_model_drafts.sql. Run by hand only.
-- Restores save_campaign and set_task_status exactly as in 20261203120000, drops the model-draft function and the new
-- columns (campaign briefs, channels, schedules, dependencies and model-written task drafts are lost).
begin;
drop function if exists public.save_task_model_draft(uuid, text, text, text);
create or replace function public.save_campaign(p_org uuid, p_campaign jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_task jsonb;
  v_pos integer := 0;
begin
  if not app_private.can_act_for(p_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_campaign -> 'tasks') is distinct from 'array' or jsonb_array_length(p_campaign -> 'tasks') not between 1 and 20
     or jsonb_typeof(p_campaign -> 'title') is distinct from 'string' or jsonb_typeof(p_campaign -> 'playbook') is distinct from 'string'
     or jsonb_typeof(p_campaign -> 'goal') is distinct from 'string' or jsonb_typeof(p_campaign -> 'summary') is distinct from 'string' then
    raise exception 'The campaign is not in the expected shape' using errcode = '22023', hint = 'invalid_campaign';
  end if;
  for v_task in select * from jsonb_array_elements(p_campaign -> 'tasks') loop
    if (v_task ->> 'card_id') is not null and not exists (
      select 1 from public.action_cards where id::text = v_task ->> 'card_id' and organization_id = p_org and status in ('new', 'approved', 'in_progress')) then
      raise exception 'A task must point at an open action of this business' using errcode = '22023', hint = 'unknown_card';
    end if;
  end loop;
  update public.marketing_campaigns set status = 'dismissed', decided_at = now()
   where organization_id = p_org and playbook = p_campaign ->> 'playbook' and status = 'proposed';
  insert into public.marketing_campaigns (organization_id, playbook, title, goal, summary, basis, created_by)
  values (p_org, p_campaign ->> 'playbook', p_campaign ->> 'title', p_campaign ->> 'goal', p_campaign ->> 'summary',
          coalesce(p_campaign -> 'basis', '{}'::jsonb), (select auth.uid()))
  returning id into v_id;
  for v_task in select * from jsonb_array_elements(p_campaign -> 'tasks') loop
    v_pos := v_pos + 1;
    insert into public.campaign_tasks (campaign_id, organization_id, position, kind, title, why, steps, deliverable, card_id, evidence_class, basis)
    values (v_id, p_org, v_pos, v_task ->> 'kind', v_task ->> 'title', v_task ->> 'why', coalesce(v_task -> 'steps', '[]'::jsonb),
            v_task ->> 'deliverable', nullif(v_task ->> 'card_id', '')::uuid, v_task ->> 'evidence_class', v_task ->> 'basis');
  end loop;
  perform app_private.log_activity(p_org, 'campaign.proposed', 'marketing_campaign', v_id::text, jsonb_build_object('tasks', v_pos));
  return v_id;
end $$;
create or replace function public.set_task_status(p_task uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t record;
begin
  select t.id, t.organization_id, t.campaign_id, c.status as cstatus into v_t
    from public.campaign_tasks t join public.marketing_campaigns c on c.id = t.campaign_id where t.id = p_task for update of t;
  if v_t.id is null or not app_private.is_org_member(v_t.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_status not in ('approved', 'done', 'skipped') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if v_t.cstatus not in ('approved', 'completed') then
    raise exception 'The owner has to approve the campaign first' using errcode = 'P0001', hint = 'not_approved';
  end if;
  update public.campaign_tasks set status = p_status, note = left(p_note, 500),
    done_at = case when p_status in ('done', 'skipped') then now() end,
    done_by = case when p_status in ('done', 'skipped') then (select auth.uid()) end
   where id = p_task;
  update public.marketing_campaigns set status = case
      when exists (select 1 from public.campaign_tasks where campaign_id = v_t.campaign_id and status in ('prepared', 'approved')) then 'approved'
      else 'completed' end
   where id = v_t.campaign_id and status in ('approved', 'completed');
  perform app_private.log_activity(v_t.organization_id, 'campaign.task_' || p_status, 'campaign_task', p_task::text, '{}'::jsonb);
end $$;
revoke all on function public.save_campaign(uuid, jsonb), public.set_task_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.save_campaign(uuid, jsonb), public.set_task_status(uuid, text, text) to authenticated;
alter table public.campaign_tasks
  drop column if exists deliverable_model_at, drop column if exists deliverable_model_by, drop column if exists deliverable_model,
  drop column if exists depends_on, drop column if exists due_in_days, drop column if exists channel;
alter table public.marketing_campaigns drop column if exists brief;
commit;
