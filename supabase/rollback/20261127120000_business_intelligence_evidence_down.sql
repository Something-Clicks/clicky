-- Rollback for 20261127120000_business_intelligence_evidence.sql. Run by hand only.
-- Data removed: every business_facts row, and the evidence_class / evidence_basis columns on
-- action_cards (derived for every existing card, so nothing original is lost). Activity log kept.
begin;

drop function if exists public.add_business_fact(uuid, text, text, text);
drop function if exists public.review_business_fact(uuid, text, text);
drop function if exists public.propose_business_facts(uuid, uuid, jsonb);
drop table if exists public.business_facts;
drop function if exists app_private.business_fact_field_ok(text, text);

drop trigger if exists action_card_evidence_class on public.action_card_evidence;
drop trigger if exists action_cards_evidence_class on public.action_cards;
drop function if exists app_private.card_evidence_class_trigger();
drop function if exists app_private.enforce_card_evidence_class(uuid);
drop function if exists app_private.class_from_kinds(text[]);
alter table public.action_cards drop column if exists evidence_basis, drop column if exists evidence_class;

commit;
