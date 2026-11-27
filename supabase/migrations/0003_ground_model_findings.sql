-- DEVELOPMENT (clicky-dev) ONLY. Not applied to production.
-- Model findings must cite evidence, and every quoted excerpt must be found in the page text the application stored.

create table if not exists public.analysis_pages (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url text not null check (length(url) between 1 and 500),
  body text not null check (length(body) between 1 and 300000),
  fetched_at timestamptz not null default now(),
  unique (analysis_id, url)
);
create index if not exists analysis_pages_org_idx on public.analysis_pages (organization_id);
alter table public.analysis_pages enable row level security;
alter table public.analysis_pages force row level security;
revoke all on public.analysis_pages from anon, authenticated;
grant select on public.analysis_pages to authenticated;
drop policy if exists analysis_pages_member_read on public.analysis_pages;
create policy analysis_pages_member_read on public.analysis_pages for select to authenticated
  using (app_private.is_org_member(organization_id));

-- Page text can only be recorded by the server (server key), so customers cannot plant text to "ground" a fabricated quote.
create or replace function public.record_analysis_pages(p_analysis uuid, p_pages jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_an record; v_page jsonb; v_n integer := 0;
begin
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
  select id, organization_id into v_an from public.analyses where id = p_analysis;
  if v_an.id is null or not app_private.can_act_for(v_an.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) not between 1 and 30 then
    raise exception 'Invalid pages payload' using errcode = '22023';
  end if;
  for v_page in select * from jsonb_array_elements(p_pages) loop
    insert into public.analysis_pages (analysis_id, organization_id, url, body)
    values (p_analysis, v_an.organization_id, v_page ->> 'url', v_page ->> 'body')
    on conflict (analysis_id, url) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.record_analysis_pages(uuid, jsonb) from public, anon;
grant execute on function public.record_analysis_pages(uuid, jsonb) to authenticated;

create or replace function app_private.norm_text(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(coalesce(p, '')), '\s+', ' ', 'g'));
$$;

create or replace function public.add_model_findings(p_analysis uuid, p_evidence jsonb, p_cards jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_an record; v_ev jsonb; v_card jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_ev_id uuid; v_card_id uuid; v_key text; v_k text; v_cited integer;
  v_added integer := 0; v_class text; v_excerpt text;
begin
  if app_private.config_bigint('agent_functions_enabled', 0) <> 1 then
    raise exception 'Not available yet' using errcode = '42501', hint = 'disabled';
  end if;
  if not app_private.agent_key_ok() then
    raise exception 'Not available' using errcode = '42501', hint = 'agent_key';
  end if;
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
    v_k := coalesce(v_ev ->> 'key', '');
    v_excerpt := coalesce(v_ev ->> 'excerpt', '');
    if v_k !~ '^[a-z0-9_]{1,40}$' or v_keys ? v_k then
      raise exception 'Evidence needs a unique key' using errcode = '22023', hint = 'evidence_key';
    end if;
    if length(btrim(v_excerpt)) < 12 or coalesce(v_ev ->> 'url', '') = '' then
      raise exception 'A quote needs a page and at least 12 characters of text' using errcode = '22023', hint = 'ungrounded_quote';
    end if;
    -- The quote must appear in the page text the application stored for this analysis.
    if not exists (
      select 1 from public.analysis_pages pg
      where pg.analysis_id = p_analysis and pg.url = v_ev ->> 'url'
        and position(app_private.norm_text(v_excerpt) in app_private.norm_text(pg.body)) > 0
    ) then
      raise exception 'Quote not found in the stored page text' using errcode = '22023', hint = 'ungrounded_quote';
    end if;
    insert into public.analysis_evidence (analysis_id, organization_id, source, kind, check_key, url, observation, excerpt)
    values (p_analysis, v_an.organization_id, 'website', 'observed', 'model.quote', v_ev ->> 'url',
            coalesce(nullif(v_ev ->> 'observation', ''), 'Quoted from the page.'), v_excerpt)
    returning id into v_ev_id;
    v_keys := v_keys || jsonb_build_object(v_k, v_ev_id);
  end loop;

  for v_card in select * from jsonb_array_elements(p_cards) loop
    if coalesce(v_card ->> 'check_key', '') !~ '^model\.[a-z0-9_]{1,60}$' then
      raise exception 'Model findings use model.* keys' using errcode = '22023';
    end if;
    v_class := coalesce(v_card ->> 'evidence_class', '');
    if v_class not in ('verified', 'inferred', 'estimated') then
      raise exception 'A finding needs evidence: verified, inferred or estimated' using errcode = '23514';
    end if;
    if v_class in ('verified', 'inferred')
       and (jsonb_typeof(v_card -> 'evidence_keys') <> 'array' or jsonb_array_length(v_card -> 'evidence_keys') < 1) then
      raise exception 'A % finding must cite at least one quote from the website', v_class using errcode = '23514', hint = 'evidence_required';
    end if;
    if v_class = 'estimated' and length(btrim(coalesce(v_card ->> 'evidence_basis', ''))) < 10 then
      raise exception 'An estimate must state its basis' using errcode = '23514', hint = 'basis_required';
    end if;
    insert into public.action_cards (
      organization_id, analysis_id, check_key, title, explanation, why_it_matters, recommended_action, expected_benefit,
      impact_priority, confidence, ai_capable, execution_type, approval_required, wording, origin, evidence_class, evidence_basis)
    values (
      v_an.organization_id, p_analysis, v_card ->> 'check_key', v_card ->> 'title', v_card ->> 'explanation',
      v_card ->> 'why_it_matters', v_card ->> 'recommended_action', v_card ->> 'expected_benefit',
      v_card ->> 'impact_priority', v_card ->> 'confidence', coalesce((v_card ->> 'ai_capable')::boolean, false),
      coalesce(v_card ->> 'execution_type', 'manual'), true, 'ai', 'model', v_class,
      nullif(btrim(coalesce(v_card ->> 'evidence_basis', '')), ''))
    returning id into v_card_id;
    v_cited := 0;
    for v_key in select jsonb_array_elements_text(coalesce(v_card -> 'evidence_keys', '[]'::jsonb)) loop
      if not v_keys ? v_key then
        raise exception 'A finding cites evidence that was not supplied' using errcode = '22023';
      end if;
      insert into public.action_card_evidence (action_card_id, evidence_id, organization_id)
      values (v_card_id, (v_keys ->> v_key)::uuid, v_an.organization_id) on conflict do nothing;
      v_cited := v_cited + 1;
    end loop;
    v_added := v_added + 1;
  end loop;

  perform app_private.log_activity(v_an.organization_id, 'workflow.model_findings', 'analysis', p_analysis::text,
    jsonb_build_object('cards', v_added));
  return v_added;
end $$;
