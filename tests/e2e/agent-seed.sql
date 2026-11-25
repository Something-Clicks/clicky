-- Fixtures for tests/e2e/agent-screens.spec.ts, for the clicky-dev Supabase project (ref ofstvbgaoznipsiqbjjp) ONLY.
-- Needs the e2e users from dev-seed.sql. Guard: run  set app.allow_e2e_seed = 'on';  first.
-- Safe to re-run: it removes its own earlier fixtures (provider 'e2e-fixture', request 'e2e fixture run') and the
-- business details on the test business, then writes them again. It writes FIXTURES, not model output.
-- It enables pat-d / other-d / admin-d (disable again afterwards: update auth.users set banned_until = now() + interval '100 years' where email like '%@e2e.test';).
do $$
declare
  v_org uuid; v_an uuid; v_owner uuid; v_member uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
begin
  if coalesce(current_setting('app.allow_e2e_seed', true), '') <> 'on' then
    raise exception 'Refusing to seed: this is for clicky-dev only. Run  set app.allow_e2e_seed = ''on'';  first.';
  end if;
  select id into v_owner from auth.users where email = 'pat-d@e2e.test';
  select id into v_member from auth.users where email = 'other-d@e2e.test';
  select organization_id into v_org from public.organization_members where user_id = v_owner and role = 'owner' limit 1;
  select id into v_an from public.analyses where organization_id = v_org and completed_at is not null order by completed_at desc limit 1;
  select id into v_c1 from public.action_cards where organization_id = v_org and title = 'Give your homepage a clear main headline' and status in ('new','approved','in_progress') limit 1;
  select id into v_c2 from public.action_cards where organization_id = v_org and title = 'Let phone visitors call you with one tap' and status in ('new','approved','in_progress') limit 1;
  select id into v_c3 from public.action_cards where organization_id = v_org and title = 'Add a short description for search results' and status in ('new','approved','in_progress') limit 1;
  if v_org is null or v_an is null or v_c1 is null or v_c2 is null or v_c3 is null then
    raise exception 'The test business needs its completed analysis and three open cards (see dev-seed.sql and the journey tests)';
  end if;

  update auth.users set banned_until = null where email in ('pat-d@e2e.test', 'other-d@e2e.test', 'admin-d@e2e.test');
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_member, 'member') on conflict do nothing;

  delete from public.marketing_plans where provider = 'e2e-fixture';
  delete from public.model_usage where provider = 'e2e-fixture';
  delete from public.marketing_workflows where request = 'e2e fixture run';
  delete from public.business_facts where organization_id = v_org;

  insert into public.business_facts (organization_id, analysis_id, category, field, value, source, evidence_class, basis, evidence, status) values
   (v_org, v_an, 'business', 'service', 'Drain cleaning', 'model', 'verified', null, '[{"kind":"observed","url":"https://claim-d.example/","excerpt":"We clear drains for homes"}]', 'proposed'),
   (v_org, v_an, 'brand', 'positioning', 'A local, family-run alternative for home plumbing', 'model', 'inferred', 'Stresses family ownership and local service.', '[{"kind":"observed","url":"https://claim-d.example/","excerpt":"Family owned since the start"}]', 'proposed'),
   (v_org, v_an, 'business', 'trust_signal', 'The site states it is family owned', 'model', 'verified', null, '[{"kind":"observed","url":"http://","excerpt":"Family owned"}]', 'proposed'),
   (v_org, v_an, 'business', 'contact_phone', '(801) 555-0100', 'website', 'verified', null, '[{"kind":"observed","url":"https://claim-d.example/","excerpt":"Call (801) 555-0100"}]', 'proposed');

  insert into public.marketing_plans (organization_id, analysis_id, plan, status, provider, model, created_by) values (v_org, v_an, jsonb_build_object(
    'summary', 'Claim D Plumbing serves homeowners. The plan makes the homepage say what you do and makes booking one tap.',
    'objectives', jsonb_build_array(jsonb_build_object('objective', 'Make it obvious what you do and how to book', 'based_on', jsonb_build_array('service'))),
    'priorities', jsonb_build_array(
      jsonb_build_object('card_id', v_c1, 'order', 1, 'why_now', 'Visitors decide in seconds, so the headline must name drain cleaning before anything else.', 'effort', 'small', 'based_on', jsonb_build_array('service'), 'depends_on', '[]'::jsonb),
      jsonb_build_object('card_id', v_c2, 'order', 2, 'why_now', 'Most customers call, so a one-tap call link turns a clear headline into a booking.', 'effort', 'small', 'based_on', '[]'::jsonb, 'depends_on', jsonb_build_array(v_c1))),
    'next_steps', jsonb_build_array('Rewrite the homepage headline to name drain cleaning.'),
    'questions', jsonb_build_array('Do you serve outside your home county?'),
    'not_now', jsonb_build_array(jsonb_build_object('card_id', v_c3, 'reason', 'Do it after the headline is clear.'))),
    'proposed', 'e2e-fixture', 'e2e-fixture', v_owner);

  insert into public.model_usage (organization_id, capability, provider, model, input_tokens, output_tokens, cost_micro, outcome) values
   (v_org, 'agent.fixture', 'e2e-fixture', 'e2e-fixture', 1000, 200, 4000, 'ok'),
   (v_org, 'agent.fixture', 'e2e-fixture', 'e2e-fixture', 0, 0, 90000, 'reserved');

  insert into public.marketing_workflows (organization_id, kind, status, request, capabilities, analysis_id, steps, result, provider, model, usage, started_by, completed_at)
  values (v_org, 'website_review', 'prepared', 'e2e fixture run', '{business_intelligence,website_intelligence}', v_an,
    '[{"step":"understand_business","status":"done","detail":"fixture","at":"2026-11-25T00:00:00Z"},{"step":"analyze_marketing_model","status":"failed","detail":"The model step did not complete; the other results are unaffected.","at":"2026-11-25T00:00:01Z"}]',
    '{"source":"website_check"}', 'e2e-fixture', 'e2e-fixture', '{"input_tokens":1000,"output_tokens":200}', v_owner, now());
end $$;
