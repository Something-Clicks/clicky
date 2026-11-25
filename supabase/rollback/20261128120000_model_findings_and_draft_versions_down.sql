-- Rollback for 20261128120000_model_findings_and_draft_versions.sql. Run by hand only, before the
-- 20261127120000 rollback (newest first).
-- Data removed: every draft_versions row (draft edits) and approvals.approved_version_id; model findings
-- (action cards with origin 'model') are kept as cards. verify_outcomes is restored to its original body.
begin;

drop function if exists public.approve_draft_version(uuid, uuid);
drop function if exists public.edit_draft(uuid, jsonb);
drop trigger if exists approvals_record_version on public.approvals;
drop trigger if exists approvals_first_version on public.approvals;
drop function if exists app_private.record_approved_version();
drop function if exists app_private.create_first_draft_version();
drop index if exists public.approvals_approved_version_idx;
alter table public.approvals drop column if exists approved_version_id;
drop table if exists public.draft_versions;
drop function if exists public.add_model_findings(uuid, jsonb, jsonb);

-- Original verify_outcomes (20261119160000_measurement_retention.sql), restored exactly.
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

commit;
