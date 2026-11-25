-- Something Clicks Marketing Agent: Business Intelligence and the four evidence classes.
--
-- Additive. Rollback: supabase/rollback/20261127120000_business_intelligence_evidence_down.sql.
-- No existing function is replaced; existing rows are only backfilled with a derived value.
--
-- 1. Evidence classes on Action Cards (specification §6.3):
--      verified | inferred | estimated | unknown, plus evidence_basis.
--    * Fixed-check cards (origin 'website_check'): the class is DERIVED from the kinds of evidence the
--      card cites (observed/measured → verified, estimated → estimated, otherwise unknown). It cannot be
--      set to anything else.
--    * Model cards (origin 'model', future): the class is supplied and VALIDATED at commit:
--      verified must cite observed/measured evidence; inferred must cite evidence and state a basis;
--      estimated must state a basis.
--    Enforced by deferred constraint triggers, so complete_analysis and claim_preview work unchanged.
--
-- 2. business_facts: the structured Business, Brand and Customer profile (§3, §14). Every fact has a
--    source (owner / website / model / research), an evidence class, evidence items, a basis where
--    needed, a status (proposed / confirmed / rejected / superseded) and when it was last observed.
--    Proposals come from the Marketing Agent; only the owner confirms, edits, rejects or adds facts.
--    The existing business_profiles row (name, website, service area, goal) stays the source of truth
--    for those fields.

-- ── 1. evidence classes on Action Cards ────────────────────────────────────
alter table public.action_cards
  add column evidence_class text check (evidence_class is null or evidence_class in ('verified', 'inferred', 'estimated', 'unknown')),
  add column evidence_basis text check (evidence_basis is null or length(evidence_basis) <= 1000);

create function app_private.class_from_kinds(p_kinds text[]) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_kinds && array['observed', 'measured'] then 'verified'
    when p_kinds && array['estimated'] then 'estimated'
    else 'unknown'
  end;
$$;

-- Sets (fixed checks) or validates (model findings) one card's evidence class.
create function app_private.enforce_card_evidence_class(p_card uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_card record;
  v_kinds text[];
  v_derived text;
begin
  select id, origin, evidence_class, evidence_basis into v_card from public.action_cards where id = p_card;
  if v_card.id is null then
    return; -- the card was deleted in the same transaction
  end if;
  select coalesce(array_agg(e.kind), '{}') into v_kinds
  from public.action_card_evidence ace join public.analysis_evidence e on e.id = ace.evidence_id
  where ace.action_card_id = p_card;

  if v_card.origin = 'website_check' then
    v_derived := app_private.class_from_kinds(v_kinds);
    if v_card.evidence_class is distinct from v_derived then
      update public.action_cards set evidence_class = v_derived where id = p_card;
    end if;
    return;
  end if;

  if v_card.evidence_class is null then
    raise exception 'A model finding needs an evidence class' using errcode = '23514';
  end if;
  if v_card.evidence_class = 'verified' and not v_kinds && array['observed', 'measured'] then
    raise exception 'A verified finding must cite observed or measured evidence' using errcode = '23514';
  end if;
  if v_card.evidence_class = 'inferred' and (cardinality(v_kinds) = 0 or coalesce(btrim(v_card.evidence_basis), '') = '') then
    raise exception 'An inferred finding must cite evidence and state its basis' using errcode = '23514';
  end if;
  if v_card.evidence_class = 'estimated' and coalesce(btrim(v_card.evidence_basis), '') = '' then
    raise exception 'An estimated finding must state its basis' using errcode = '23514';
  end if;
end $$;

create function app_private.card_evidence_class_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'action_cards' then
    perform app_private.enforce_card_evidence_class(new.id);
  elsif tg_op = 'DELETE' then
    perform app_private.enforce_card_evidence_class(old.action_card_id);
  else
    perform app_private.enforce_card_evidence_class(new.action_card_id);
  end if;
  return null;
end $$;


-- Backfill existing cards from their evidence, without touching updated_at.
alter table public.action_cards disable trigger action_cards_updated_at;
update public.action_cards c
set evidence_class = app_private.class_from_kinds(coalesce((
  select array_agg(e.kind) from public.action_card_evidence ace join public.analysis_evidence e on e.id = ace.evidence_id
  where ace.action_card_id = c.id), '{}'))
where c.evidence_class is null;
alter table public.action_cards enable trigger action_cards_updated_at;

-- Triggers are created after the backfill so it queues no deferred events.
create constraint trigger action_cards_evidence_class
  after insert or update of evidence_class, evidence_basis, origin on public.action_cards
  deferrable initially deferred for each row execute function app_private.card_evidence_class_trigger();
create constraint trigger action_card_evidence_class
  after insert or delete on public.action_card_evidence
  deferrable initially deferred for each row execute function app_private.card_evidence_class_trigger();

revoke all on function app_private.class_from_kinds(text[]), app_private.enforce_card_evidence_class(uuid),
  app_private.card_evidence_class_trigger() from public, anon, authenticated;

-- ── 2. business facts ───────────────────────────────────────────────────────
create function app_private.business_fact_field_ok(p_category text, p_field text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_category
    when 'business' then p_field in ('what_it_does', 'industry', 'business_model', 'service', 'product', 'service_area',
      'location', 'contact_phone', 'contact_email', 'pricing', 'competitive_advantage', 'goal', 'marketing_objective', 'constraint')
    when 'brand' then p_field in ('voice', 'tone', 'value_proposition', 'key_message', 'preferred_term', 'avoid_term', 'brand_guideline')
    when 'customer' then p_field in ('audience', 'customer_problem', 'motivation', 'objection', 'customer_question', 'decision_factor')
    else false
  end;
$$;

create table public.business_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  category text not null check (category in ('business', 'brand', 'customer')),
  field text not null,
  value text check (value is null or length(btrim(value)) between 1 and 500),
  source text not null check (source in ('owner', 'website', 'model', 'research')),
  evidence_class text not null check (evidence_class in ('verified', 'inferred', 'estimated', 'unknown')),
  basis text check (basis is null or length(basis) <= 1000),
  -- [{ "kind": observed|measured|estimated|missing, "url": ..., "excerpt": ..., "evidence_id": ... }]
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'rejected', 'superseded')),
  analysis_id uuid references public.analyses (id) on delete set null,
  observed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_facts_field_check check (app_private.business_fact_field_ok(category, field)),
  constraint business_facts_evidence_shape check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 10),
  -- unknown carries no value; every other class carries one
  constraint business_facts_unknown_value check ((evidence_class = 'unknown') = (value is null)),
  -- verified: supplied or confirmed by the owner, or directly observed/measured
  constraint business_facts_verified check (evidence_class <> 'verified' or source = 'owner' or status = 'confirmed'
    or jsonb_path_exists(evidence, '$[*] ? (@.kind == "observed" || @.kind == "measured")')),
  constraint business_facts_inferred check (evidence_class <> 'inferred'
    or (jsonb_array_length(evidence) > 0 and length(btrim(coalesce(basis, ''))) > 0)),
  constraint business_facts_estimated check (evidence_class <> 'estimated' or length(btrim(coalesce(basis, ''))) > 0),
  -- the owner's own facts are confirmed and verified by definition
  constraint business_facts_owner check (source <> 'owner' or (evidence_class = 'verified' and status in ('confirmed', 'superseded')))
);
create index business_facts_org_idx on public.business_facts (organization_id, category, field);
create index business_facts_analysis_idx on public.business_facts (analysis_id);
create index business_facts_confirmed_by_idx on public.business_facts (confirmed_by);
-- One active copy of a fact.
create unique index business_facts_one_active_idx on public.business_facts (organization_id, field, lower(coalesce(value, '')))
  where status in ('proposed', 'confirmed');
create trigger business_facts_updated_at before update on public.business_facts
  for each row execute function app_private.touch_updated_at();

revoke all on public.business_facts from anon, authenticated;
grant select on public.business_facts to authenticated;
alter table public.business_facts enable row level security;
create policy "Members read business facts" on public.business_facts for select to authenticated
  using (app_private.is_org_member(organization_id));

-- The Marketing Agent proposes facts (from the website now; from a model or research later).
-- Identical active facts are refreshed (observed_at) instead of duplicated; facts the owner rejected
-- are not proposed again. Returns how many new facts were added.
create function public.propose_business_facts(p_org uuid, p_analysis uuid, p_facts jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_fact jsonb;
  v_added integer := 0;
  v_existing_id uuid;
  v_existing_status text;
begin
  if not app_private.can_act_for(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if p_analysis is not null and not exists (select 1 from public.analyses where id = p_analysis and organization_id = p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) > 50 then
    raise exception 'Invalid facts payload' using errcode = '22023';
  end if;

  for v_fact in select * from jsonb_array_elements(p_facts) loop
    if coalesce(v_fact ->> 'source', '') not in ('website', 'model', 'research') then
      raise exception 'Proposed facts come from the website, a model or research' using errcode = '22023';
    end if;
    if not app_private.business_fact_field_ok(v_fact ->> 'category', v_fact ->> 'field') then
      raise exception 'Unknown business detail %.%', v_fact ->> 'category', v_fact ->> 'field' using errcode = '23514', hint = 'business_facts_field_check';
    end if;
    v_existing_id := null;
    v_existing_status := null;
    select id, status into v_existing_id, v_existing_status from public.business_facts
    where organization_id = p_org and field = v_fact ->> 'field'
      and lower(coalesce(value, '')) = lower(coalesce(v_fact ->> 'value', ''))
      and status in ('proposed', 'confirmed', 'rejected')
    order by (status = 'rejected') desc
    limit 1;
    if v_existing_id is not null then
      if v_existing_status <> 'rejected' then
        update public.business_facts set observed_at = now(), analysis_id = coalesce(p_analysis, analysis_id)
        where id = v_existing_id;
      end if;
      continue;
    end if;
    insert into public.business_facts (organization_id, category, field, value, source, evidence_class, basis, evidence, analysis_id)
    values (p_org, v_fact ->> 'category', v_fact ->> 'field', nullif(btrim(v_fact ->> 'value'), ''), v_fact ->> 'source',
            v_fact ->> 'evidence_class', nullif(btrim(coalesce(v_fact ->> 'basis', '')), ''),
            coalesce(v_fact -> 'evidence', '[]'::jsonb), p_analysis);
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then
    perform app_private.log_activity(p_org, 'business_fact.proposed', 'organization', p_org::text,
      jsonb_build_object('added', v_added, 'analysis_id', p_analysis));
  end if;
  return v_added;
end $$;

-- The owner confirms (optionally correcting the value) or rejects a proposed fact.
-- A corrected value becomes a new owner fact; the proposal is kept as superseded.
create function public.review_business_fact(p_fact uuid, p_decision text, p_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fact record;
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_new uuid;
begin
  select * into v_fact from public.business_facts where id = p_fact for update;
  if v_fact.id is null or not app_private.is_org_member(v_fact.organization_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not app_private.has_org_role(v_fact.organization_id, 'owner') then
    raise exception 'Only the account owner can review business details' using errcode = '42501', hint = 'owner_only';
  end if;
  if v_fact.status <> 'proposed' then
    raise exception 'Already reviewed' using errcode = 'P0001', hint = 'already_reviewed';
  end if;
  if p_decision = 'reject' then
    update public.business_facts set status = 'rejected' where id = p_fact;
    perform app_private.log_activity(v_fact.organization_id, 'business_fact.rejected', 'business_fact', p_fact::text, '{}'::jsonb);
    return p_fact;
  end if;
  if p_decision <> 'confirm' then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  if v_value is null or lower(v_value) = lower(coalesce(v_fact.value, '')) then
    if v_fact.value is null then
      raise exception 'Add the missing detail to confirm it' using errcode = '22023';
    end if;
    update public.business_facts
    set status = 'confirmed', evidence_class = 'verified', confirmed_by = (select auth.uid()), confirmed_at = now()
    where id = p_fact;
    v_new := p_fact;
  else
    update public.business_facts set status = 'superseded' where id = p_fact;
    insert into public.business_facts (organization_id, category, field, value, source, evidence_class, status, confirmed_by, confirmed_at)
    values (v_fact.organization_id, v_fact.category, v_fact.field, v_value, 'owner', 'verified', 'confirmed', (select auth.uid()), now())
    returning id into v_new;
  end if;
  perform app_private.log_activity(v_fact.organization_id, 'business_fact.confirmed', 'business_fact', v_new::text,
    jsonb_build_object('field', v_fact.field, 'corrected', v_new <> p_fact));
  return v_new;
end $$;

-- The owner adds a fact directly.
create function public.add_business_fact(p_org uuid, p_category text, p_field text, p_value text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not app_private.is_org_member(p_org) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if not app_private.has_org_role(p_org, 'owner') then
    raise exception 'Only the account owner can add business details' using errcode = '42501', hint = 'owner_only';
  end if;
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    raise exception 'Add a value' using errcode = '22023';
  end if;
  insert into public.business_facts (organization_id, category, field, value, source, evidence_class, status, confirmed_by, confirmed_at)
  values (p_org, p_category, p_field, btrim(p_value), 'owner', 'verified', 'confirmed', (select auth.uid()), now())
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'That detail is already there' using errcode = 'P0001', hint = 'duplicate';
  end if;
  perform app_private.log_activity(p_org, 'business_fact.added', 'business_fact', v_id::text, jsonb_build_object('field', p_field));
  return v_id;
end $$;

revoke all on function public.propose_business_facts(uuid, uuid, jsonb), public.review_business_fact(uuid, text, text),
  public.add_business_fact(uuid, text, text, text), app_private.business_fact_field_ok(text, text)
  from public, anon, authenticated;
grant execute on function public.propose_business_facts(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.review_business_fact(uuid, text, text), public.add_business_fact(uuid, text, text, text) to authenticated;
grant execute on function app_private.business_fact_field_ok(text, text) to authenticated, service_role;
