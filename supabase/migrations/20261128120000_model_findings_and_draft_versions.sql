-- Something Clicks Marketing Agent: model-assisted findings, and editable draft versions with owner approval.
--
-- Additive, plus one replaced function (app_private.verify_outcomes; the rollback restores the original).
-- Rollback: supabase/rollback/20261128120000_model_findings_and_draft_versions_down.sql.
--
-- 1. add_model_findings: Marketing Analysis saves model-assisted findings (origin 'model') for an analysis
--    that has just completed, each citing quotes from the website saved as observed evidence. The
--    evidence-class rules from 20261127120000 are enforced at commit. One set per analysis, at most 8.
-- 2. verify_outcomes now checks only fixed-check cards: a model finding not repeated in the next analysis
--    is NOT evidence that it was fixed (its wording varies run to run), so it is never marked "fixed".
-- 3. draft_versions: every prepared draft starts as version 1 (the model's draft, created automatically
--    with the approval). Members can edit while it waits for approval; each edit is a new version (who, when).
--    Only the owner approves, and approves a specific version (approve_draft_version). Approval is not
--    completion. An approval made through decide_approval records the latest version.

-- ── 1. model findings ───────────────────────────────────────────────────────
create function public.add_model_findings(p_analysis uuid, p_evidence jsonb, p_cards jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_an record;
  v_ev jsonb;
  v_card jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_ev_id uuid;
  v_card_id uuid;
  v_key text;
  v_added integer := 0;
begin
  select id, organization_id, status, completed_at into v_an from public.analyses where id = p_analysis for update;
  if v_an.id is null or not app_private.can_act_for(v_an.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if v_an.status <> 'complete' or v_an.completed_at < now() - interval '1 hour' then
    raise exception 'Findings can only be added to an analysis that just finished' using errcode = 'P0001', hint = 'analysis_not_current';
  end if;
  if exists (select 1 from public.action_cards where analysis_id = p_analysis and origin = 'model') then
    raise exception 'Model findings were already added to this analysis' using errcode = 'P0001', hint = 'already_added';
  end if;
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_typeof(p_cards) <> 'array'
     or jsonb_array_length(p_evidence) > 40 or jsonb_array_length(p_cards) > 8 then
    raise exception 'Invalid findings payload' using errcode = '22023';
  end if;

  for v_ev in select * from jsonb_array_elements(p_evidence) loop
    insert into public.analysis_evidence (analysis_id, organization_id, source, kind, check_key, url, observation, excerpt)
    values (p_analysis, v_an.organization_id, 'website', 'observed', 'model.quote', v_ev ->> 'url',
            coalesce(nullif(v_ev ->> 'observation', ''), 'Quoted from the page.'), v_ev ->> 'excerpt')
    returning id into v_ev_id;
    v_keys := v_keys || jsonb_build_object(v_ev ->> 'key', v_ev_id);
  end loop;

  for v_card in select * from jsonb_array_elements(p_cards) loop
    if coalesce(v_card ->> 'check_key', '') !~ '^model\.[a-z0-9_]{1,60}$' then
      raise exception 'Model findings use model.* keys' using errcode = '22023';
    end if;
    if coalesce(v_card ->> 'evidence_class', '') not in ('verified', 'inferred', 'estimated') then
      raise exception 'A finding needs evidence: verified, inferred or estimated' using errcode = '23514';
    end if;
    insert into public.action_cards (
      organization_id, analysis_id, check_key, title, explanation, why_it_matters, recommended_action, expected_benefit,
      impact_priority, confidence, ai_capable, execution_type, approval_required, wording, origin, evidence_class, evidence_basis)
    values (
      v_an.organization_id, p_analysis, v_card ->> 'check_key', v_card ->> 'title', v_card ->> 'explanation',
      v_card ->> 'why_it_matters', v_card ->> 'recommended_action', v_card ->> 'expected_benefit',
      v_card ->> 'impact_priority', v_card ->> 'confidence', coalesce((v_card ->> 'ai_capable')::boolean, false),
      coalesce(v_card ->> 'execution_type', 'manual'), true, 'ai', 'model', v_card ->> 'evidence_class',
      nullif(btrim(coalesce(v_card ->> 'evidence_basis', '')), ''))
    returning id into v_card_id;
    for v_key in select jsonb_array_elements_text(coalesce(v_card -> 'evidence_keys', '[]'::jsonb)) loop
      if not v_keys ? v_key then
        raise exception 'A finding cites evidence that was not supplied' using errcode = '22023';
      end if;
      insert into public.action_card_evidence (action_card_id, evidence_id, organization_id)
      values (v_card_id, (v_keys ->> v_key)::uuid, v_an.organization_id) on conflict do nothing;
    end loop;
    v_added := v_added + 1;
  end loop;

  -- Internal record (workflow.* entries are not shown in the customer's history).
  perform app_private.log_activity(v_an.organization_id, 'workflow.model_findings', 'analysis', p_analysis::text,
    jsonb_build_object('cards', v_added));
  return v_added;
end $$;

revoke all on function public.add_model_findings(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.add_model_findings(uuid, jsonb, jsonb) to authenticated, service_role;

-- ── 2. outcome verification: fixed-check cards only ─────────────────────────
create or replace function app_private.verify_outcomes(p_org uuid, p_analysis uuid, p_coverage jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_new text;
begin
  for c in
    select ac.id, ac.check_key, ac.verification,
           (select e.source from public.action_card_evidence ace
              join public.analysis_evidence e on e.id = ace.evidence_id
             where ace.action_card_id = ac.id limit 1) as source
    from public.action_cards ac
    where ac.organization_id = p_org and ac.status in ('done', 'approved') and ac.analysis_id <> p_analysis
      and ac.origin = 'website_check'
  loop
    if coalesce(p_coverage -> c.source ->> 'status', '') not in ('observed', 'measured') then
      continue; -- the source was not checked this time: say nothing
    end if;
    v_new := case when exists (
      select 1 from public.action_cards n where n.analysis_id = p_analysis and n.check_key = c.check_key
    ) then 'still_found' else 'fixed' end;
    update public.action_cards
    set verification = v_new, verified_at = now(), verification_analysis_id = p_analysis
    where id = c.id;
    if v_new is distinct from c.verification then
      perform app_private.log_activity(p_org, 'outcome.' || v_new, 'action_card', c.id::text,
        jsonb_build_object('analysis_id', p_analysis));
    end if;
  end loop;
end $$;

-- ── 3. draft versions ───────────────────────────────────────────────────────
create table public.draft_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  approval_id uuid not null references public.approvals (id) on delete cascade,
  version integer not null check (version between 1 and 100),
  -- { "fields": [ { "key", "label", "text" } ] }
  fields jsonb not null,
  source text not null check (source in ('model', 'owner')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (approval_id, version)
);
create index draft_versions_org_idx on public.draft_versions (organization_id);
create index draft_versions_created_by_idx on public.draft_versions (created_by);

alter table public.approvals add column approved_version_id uuid references public.draft_versions (id) on delete set null;
create index approvals_approved_version_idx on public.approvals (approved_version_id);

revoke all on public.draft_versions from anon, authenticated;
grant select on public.draft_versions to authenticated;
alter table public.draft_versions enable row level security;
create policy "Members read draft versions" on public.draft_versions for select to authenticated
  using (app_private.is_org_member(organization_id));

-- Version 1 is the prepared draft, recorded when the approval is created.
create function app_private.create_first_draft_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.draft_versions (organization_id, approval_id, version, fields, source, created_by)
  select new.organization_id, new.id, 1, jsonb_build_object('fields', r.output -> 'fields'), 'model', r.started_by
  from public.agent_runs r where r.id = new.agent_run_id and r.output ? 'fields';
  return null;
end $$;
create trigger approvals_first_version after insert on public.approvals
  for each row execute function app_private.create_first_draft_version();

-- An approval through decide_approval records the latest version as the approved one.
create function app_private.record_approved_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.decision = 'approved' and old.decision <> 'approved' and new.approved_version_id is null then
    new.approved_version_id := (select id from public.draft_versions where approval_id = new.id order by version desc limit 1);
  end if;
  return new;
end $$;
create trigger approvals_record_version before update on public.approvals
  for each row execute function app_private.record_approved_version();

-- Existing drafts get their version 1.
insert into public.draft_versions (organization_id, approval_id, version, fields, source, created_by)
select a.organization_id, a.id, 1, jsonb_build_object('fields', r.output -> 'fields'), 'model', r.started_by
from public.approvals a join public.agent_runs r on r.id = a.agent_run_id
where r.output ? 'fields' and not exists (select 1 from public.draft_versions v where v.approval_id = a.id);
update public.approvals a set approved_version_id = (select id from public.draft_versions v where v.approval_id = a.id order by version desc limit 1)
where a.decision = 'approved' and a.approved_version_id is null;

-- A member edits a draft that is waiting for approval: a new version with the same fields.
create function public.edit_draft(p_approval uuid, p_fields jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_ap record;
  v_last record;
  v_field jsonb;
  v_keys text[];
  v_new_keys text[];
  v_id uuid;
begin
  select id, organization_id, decision into v_ap from public.approvals where id = p_approval for update;
  if v_ap.id is null or not app_private.is_org_member(v_ap.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if v_ap.decision <> 'pending' then
    raise exception 'Only a draft waiting for approval can be edited' using errcode = 'P0001', hint = 'not_pending';
  end if;
  select id, version, fields into v_last from public.draft_versions where approval_id = p_approval order by version desc limit 1;
  if v_last.id is null then
    raise exception 'This draft has no content to edit' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_fields) <> 'array' or jsonb_array_length(p_fields) not between 1 and 10 then
    raise exception 'Invalid draft' using errcode = '22023';
  end if;
  for v_field in select * from jsonb_array_elements(p_fields) loop
    if coalesce(length(btrim(v_field ->> 'text')), 0) not between 1 and 8000 then
      raise exception 'Every part of the draft needs text (up to 8000 characters)' using errcode = '22023', hint = 'empty_field';
    end if;
  end loop;
  select array_agg(f ->> 'key' order by f ->> 'key') into v_keys from jsonb_array_elements(v_last.fields -> 'fields') f;
  select array_agg(f ->> 'key' order by f ->> 'key') into v_new_keys from jsonb_array_elements(p_fields) f;
  if v_keys is distinct from v_new_keys then
    raise exception 'An edit keeps the same parts of the draft' using errcode = '22023';
  end if;
  if v_last.version >= 100 then
    raise exception 'Too many versions' using errcode = 'P0001';
  end if;
  insert into public.draft_versions (organization_id, approval_id, version, fields, source, created_by)
  values (v_ap.organization_id, p_approval, v_last.version + 1,
          jsonb_build_object('fields', (
            select jsonb_agg(jsonb_build_object('key', o ->> 'key', 'label', o ->> 'label',
                     'text', btrim((select n ->> 'text' from jsonb_array_elements(p_fields) n where n ->> 'key' = o ->> 'key'))))
            from jsonb_array_elements(v_last.fields -> 'fields') o)),
          'owner', (select auth.uid()))
  returning id into v_id;
  perform app_private.log_activity(v_ap.organization_id, 'draft.edited', 'approval', p_approval::text,
    jsonb_build_object('version', v_last.version + 1));
  return v_id;
end $$;

-- The owner approves one specific version. Approval is not completion.
create function public.approve_draft_version(p_approval uuid, p_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ap record;
  v_ver record;
begin
  select id, organization_id, action_card_id, decision into v_ap from public.approvals where id = p_approval for update;
  if v_ap.id is null or not app_private.is_org_member(v_ap.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not app_private.has_org_role(v_ap.organization_id, 'owner') then
    raise exception 'Only the account owner can approve drafts' using errcode = '42501', hint = 'owner_only';
  end if;
  if v_ap.decision <> 'pending' then
    raise exception 'This draft was already decided' using errcode = 'P0001', hint = 'already_decided';
  end if;
  select id, version into v_ver from public.draft_versions where id = p_version and approval_id = p_approval;
  if v_ver.id is null then
    raise exception 'That version is not part of this draft' using errcode = '22023';
  end if;
  update public.approvals
  set decision = 'approved', approved_version_id = v_ver.id, decided_by = (select auth.uid()), decided_at = now()
  where id = p_approval;
  update public.action_cards
  set status = 'approved', result_summary = 'Draft approved. Use it on your website or profile, then mark this done.'
  where id = v_ap.action_card_id and status in ('new', 'in_progress', 'approved');
  perform app_private.log_activity(v_ap.organization_id, 'approval.approved', 'approval', p_approval::text,
    jsonb_build_object('action_card_id', v_ap.action_card_id, 'version', v_ver.version));
end $$;

revoke all on function public.edit_draft(uuid, jsonb), public.approve_draft_version(uuid, uuid),
  app_private.create_first_draft_version(), app_private.record_approved_version()
  from public, anon, authenticated;
grant execute on function public.edit_draft(uuid, jsonb), public.approve_draft_version(uuid, uuid) to authenticated;
