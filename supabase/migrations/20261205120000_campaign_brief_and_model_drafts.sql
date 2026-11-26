-- Campaign Planning (spec §8.6, §9): a campaign brief (objective, audience, offer, core message, channels, measurement),
-- per-task channel, schedule and dependencies, and drafts written by the model kept apart from the fixed template and the
-- owner's edit. Additive. Rollback: supabase/rollback/20261205120000_campaign_brief_and_model_drafts_down.sql
--
-- Rules enforced here:
--   * A task cannot be marked done before the tasks it depends on are done or skipped (for example, no email or post that
--     sends people to a landing page that is not live yet).
--   * Model-written drafts are stored only through save_task_model_draft, which needs the server key and the database switch
--     (agent_functions_enabled), like every other function that stores model output. They never replace the template or the
--     owner's edit, and nothing is ever sent or published.

alter table public.marketing_campaigns
  add column brief jsonb check (brief is null or (jsonb_typeof(brief) = 'object' and length(brief::text) <= 4000));

alter table public.campaign_tasks
  add column channel text check (channel is null or channel in ('landing_page', 'email', 'social', 'gbp', 'sms')),
  -- Suggested start, in days after the owner approves the campaign (a schedule, not a promise).
  add column due_in_days smallint check (due_in_days is null or due_in_days between 0 and 90),
  -- Positions (within the same campaign) that must be done or skipped first.
  add column depends_on smallint[] not null default '{}' check (cardinality(depends_on) <= 5),
  add column deliverable_model text check (deliverable_model is null or length(deliverable_model) <= 4000),
  add column deliverable_model_by jsonb check (deliverable_model_by is null or jsonb_typeof(deliverable_model_by) = 'object'),
  add column deliverable_model_at timestamptz;

-- save_campaign: unchanged apart from the brief and the new task fields (channel, due_in_days, depends_on).
create or replace function public.save_campaign(p_org uuid, p_campaign jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_task jsonb;
  v_pos integer := 0;
  v_deps smallint[];
begin
  if not app_private.can_act_for(p_org) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_campaign -> 'tasks') is distinct from 'array' or jsonb_array_length(p_campaign -> 'tasks') not between 1 and 20
     or jsonb_typeof(p_campaign -> 'title') is distinct from 'string' or jsonb_typeof(p_campaign -> 'playbook') is distinct from 'string'
     or jsonb_typeof(p_campaign -> 'goal') is distinct from 'string' or jsonb_typeof(p_campaign -> 'summary') is distinct from 'string'
     or (p_campaign ? 'brief' and jsonb_typeof(p_campaign -> 'brief') not in ('object', 'null')) then
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
  insert into public.marketing_campaigns (organization_id, playbook, title, goal, summary, basis, brief, created_by)
  values (p_org, p_campaign ->> 'playbook', p_campaign ->> 'title', p_campaign ->> 'goal', p_campaign ->> 'summary',
          coalesce(p_campaign -> 'basis', '{}'::jsonb), nullif(p_campaign -> 'brief', 'null'::jsonb), (select auth.uid()))
  returning id into v_id;
  for v_task in select * from jsonb_array_elements(p_campaign -> 'tasks') loop
    v_pos := v_pos + 1;
    select coalesce(array_agg(x::smallint), '{}') into v_deps from jsonb_array_elements_text(coalesce(v_task -> 'depends_on', '[]'::jsonb)) x;
    -- A task can only depend on tasks before it in the same campaign.
    if exists (select 1 from unnest(v_deps) d where d < 1 or d >= v_pos) then
      raise exception 'A task can only depend on earlier tasks' using errcode = '22023', hint = 'invalid_dependency';
    end if;
    insert into public.campaign_tasks (campaign_id, organization_id, position, kind, title, why, steps, deliverable, card_id, evidence_class, basis,
                                       channel, due_in_days, depends_on)
    values (v_id, p_org, v_pos, v_task ->> 'kind', v_task ->> 'title', v_task ->> 'why', coalesce(v_task -> 'steps', '[]'::jsonb),
            v_task ->> 'deliverable', nullif(v_task ->> 'card_id', '')::uuid, v_task ->> 'evidence_class', v_task ->> 'basis',
            v_task ->> 'channel', (v_task ->> 'due_in_days')::smallint, v_deps);
  end loop;
  perform app_private.log_activity(p_org, 'campaign.proposed', 'marketing_campaign', v_id::text, jsonb_build_object('tasks', v_pos));
  return v_id;
end $$;

-- set_task_status: as before, and a task is not done until what it depends on is done or skipped.
create or replace function public.set_task_status(p_task uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t record;
begin
  select t.id, t.organization_id, t.campaign_id, t.depends_on, c.status as cstatus into v_t
    from public.campaign_tasks t join public.marketing_campaigns c on c.id = t.campaign_id where t.id = p_task for update of t;
  if v_t.id is null or not app_private.is_org_member(v_t.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_status not in ('approved', 'done', 'skipped') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if v_t.cstatus not in ('approved', 'completed') then
    raise exception 'The owner has to approve the campaign first' using errcode = 'P0001', hint = 'not_approved';
  end if;
  if p_status = 'done' and exists (
       select 1 from public.campaign_tasks d where d.campaign_id = v_t.campaign_id and d.position = any (v_t.depends_on) and d.status not in ('done', 'skipped')) then
    raise exception 'Finish the steps this depends on first' using errcode = 'P0001', hint = 'dependency_open';
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

-- Stores a draft the model wrote for a task's channel (Content Creation). Server key and database switch required.
create function public.save_task_model_draft(p_task uuid, p_text text, p_provider text, p_model text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_t record;
begin
  if app_private.config_bigint('agent_functions_enabled', 0) <> 1 then
    raise exception 'Not available yet' using errcode = '42501', hint = 'disabled';
  end if;
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
  select t.id, t.organization_id, t.channel, c.status as cstatus into v_t
    from public.campaign_tasks t join public.marketing_campaigns c on c.id = t.campaign_id where t.id = p_task for update of t;
  if v_t.id is null or not app_private.can_act_for(v_t.organization_id) then raise exception 'Forbidden' using errcode = '42501'; end if;
  if v_t.channel is null then raise exception 'This task has nothing to write' using errcode = '22023', hint = 'no_channel'; end if;
  if v_t.cstatus = 'dismissed' then raise exception 'This campaign was dismissed' using errcode = 'P0001'; end if;
  if p_text is null or length(btrim(p_text)) = 0 or length(p_text) > 4000 then raise exception 'The draft must be 1 to 4000 characters' using errcode = '22023'; end if;
  if p_provider is null or length(p_provider) > 50 or p_model is null or length(p_model) > 100 then raise exception 'Invalid model' using errcode = '22023'; end if;
  update public.campaign_tasks
     set deliverable_model = p_text, deliverable_model_by = jsonb_build_object('provider', p_provider, 'model', p_model), deliverable_model_at = now()
   where id = p_task;
  perform app_private.log_activity(v_t.organization_id, 'campaign.task_model_draft', 'campaign_task', p_task::text,
    jsonb_build_object('provider', p_provider, 'model', p_model));
end $$;

revoke all on function public.save_task_model_draft(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_task_model_draft(uuid, text, text, text) to authenticated, service_role;
