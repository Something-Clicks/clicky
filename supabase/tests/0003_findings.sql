-- Run against clicky-dev ONLY, inside a transaction that is rolled back (the final RAISE reports results and aborts).
-- Scaffolding (test users, org, analysis, a TEST server key hash) is created and rolled back; nothing persists.
begin;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
values ('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-a@example.test','x',now(),now(),now(),'{}','{}','','','',''),
       ('a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-b@example.test','x',now(),now(),now(),'{}','{}','','','','');
insert into public.organizations (id, name, created_by) values
 ('b0000000-0000-0000-0000-00000000000a','Org A','a0000000-0000-0000-0000-000000000001'),
 ('b0000000-0000-0000-0000-00000000000b','Org B','a0000000-0000-0000-0000-000000000002');
insert into public.organization_members (organization_id, user_id, role) values
 ('b0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001','owner'),
 ('b0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000002','owner')
 on conflict do nothing;
insert into public.analyses (id, organization_id, status, website, completed_at, triggered_by)
values ('c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a','complete','https://example.test',now(),'a0000000-0000-0000-0000-000000000001');
-- TEST server key (only exists inside this transaction)
update app_private.secrets set hash = sha256(convert_to('test-server-key-0123456789-abcdefghij','UTF8')) where name='model_usage';
insert into public.analysis_pages (analysis_id, organization_id, url, body) values
 ('c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a','https://example.test/','We have served Springfield  families since 1987.  Call us today for a FREE estimate.');

create temp table t_res (n text, r text);
grant all on t_res to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

do $$
declare k jsonb; ok_ev jsonb := '[{"key":"q1","url":"https://example.test/","excerpt":"served springfield families   since 1987","observation":"Years in business"}]';
        card jsonb;
begin
  -- 1 no key
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a', ok_ev, '[]');
    insert into t_res values ('1 no key refused','FAIL: allowed');
  exception when others then insert into t_res values ('1 no key refused', case when sqlstate='42501' then 'PASS' else 'FAIL '||sqlerrm end); end;

  perform set_config('request.headers','{"x-agent-key":"test-server-key-0123456789-abcdefghij"}',true);

  -- 2 fabricated quote
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a',
    '[{"key":"q1","url":"https://example.test/","excerpt":"Voted best plumber in the county 2024","observation":"x"}]', '[]');
    insert into t_res values ('2 fabricated quote rejected','FAIL: allowed');
  exception when others then insert into t_res values ('2 fabricated quote rejected', case when sqlstate='22023' and sqlerrm like 'Quote not found%' then 'PASS' else 'FAIL '||sqlerrm end); end;

  -- 2b quote against a page that was never stored
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a',
    '[{"key":"q1","url":"https://example.test/other","excerpt":"served springfield families since 1987","observation":"x"}]', '[]');
    insert into t_res values ('2b quote from unstored page rejected','FAIL: allowed');
  exception when others then insert into t_res values ('2b quote from unstored page rejected', case when sqlstate='22023' then 'PASS' else 'FAIL '||sqlerrm end); end;

  -- 3 verified with no evidence
  card := '{"check_key":"model.age","title":"t","explanation":"e","why_it_matters":"w","recommended_action":"r","expected_benefit":"b","impact_priority":"high","confidence":"high","evidence_class":"verified","evidence_keys":[]}';
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a', ok_ev, jsonb_build_array(card));
    insert into t_res values ('3 verified without evidence rejected','FAIL: allowed');
  exception when others then insert into t_res values ('3 verified without evidence rejected', case when sqlstate='23514' then 'PASS' else 'FAIL '||sqlerrm end); end;

  -- 3b inferred with no evidence
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a', ok_ev, jsonb_build_array(jsonb_set(card,'{evidence_class}','"inferred"')));
    insert into t_res values ('3b inferred without evidence rejected','FAIL: allowed');
  exception when others then insert into t_res values ('3b inferred without evidence rejected', case when sqlstate='23514' then 'PASS' else 'FAIL '||sqlerrm end); end;

  -- 4 estimated without basis
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a', ok_ev, jsonb_build_array(jsonb_set(card,'{evidence_class}','"estimated"')));
    insert into t_res values ('4 estimate without basis rejected','FAIL: allowed');
  exception when others then insert into t_res values ('4 estimate without basis rejected', case when sqlstate='23514' then 'PASS' else 'FAIL '||sqlerrm end); end;

  -- 5 cites a key that was not supplied
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a', ok_ev, jsonb_build_array(jsonb_set(card,'{evidence_keys}','["nope"]')));
    insert into t_res values ('5 unknown evidence key rejected','FAIL: allowed');
  exception when others then insert into t_res values ('5 unknown evidence key rejected', case when sqlstate='22023' then 'PASS' else 'FAIL '||sqlerrm end); end;

  -- 6 other org's member cannot add to org A's analysis (new session user)
  perform set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a', ok_ev, '[]');
    insert into t_res values ('6 other tenant refused','FAIL: allowed');
  exception when others then insert into t_res values ('6 other tenant refused', case when sqlstate='42501' then 'PASS' else 'FAIL '||sqlerrm end); end;
  perform set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

  -- 7 customer cannot plant page text directly
  begin insert into public.analysis_pages (analysis_id, organization_id, url, body) values ('c0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a','https://example.test/x','Voted best plumber');
    insert into t_res values ('7 direct page-text insert refused','FAIL: allowed');
  exception when others then insert into t_res values ('7 direct page-text insert refused', case when sqlstate='42501' then 'PASS' else 'FAIL '||sqlerrm end); end;

  -- 8 customer cannot insert a model card directly
  begin insert into public.action_cards (organization_id, analysis_id, check_key, title, origin, evidence_class) values ('b0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000a','model.x','t','model','verified');
    insert into t_res values ('8 direct model card insert refused','FAIL: allowed');
  exception when others then insert into t_res values ('8 direct model card insert refused', case when sqlstate='42501' then 'PASS' else 'FAIL '||sqlerrm end); end;

  -- 9 valid grounded finding accepted (case/whitespace-insensitive match)
  begin
    insert into t_res values ('9 grounded finding accepted', case when public.add_model_findings('c0000000-0000-0000-0000-00000000000a', ok_ev,
      jsonb_build_array(jsonb_set(card,'{evidence_keys}','["q1"]'))) = 1 then 'PASS' else 'FAIL count' end);
  exception when others then insert into t_res values ('9 grounded finding accepted','FAIL '||sqlerrm); end;
  insert into t_res select '9b card needs owner approval + is model-origin', case when exists (select 1 from public.action_cards where analysis_id='c0000000-0000-0000-0000-00000000000a' and origin='model' and approval_required and evidence_class='verified') and exists (select 1 from public.action_card_evidence) then 'PASS' else 'FAIL' end;

  -- 10 second submission refused
  begin perform public.add_model_findings('c0000000-0000-0000-0000-00000000000a', ok_ev, '[]');
    insert into t_res values ('10 duplicate submission refused','FAIL: allowed');
  exception when others then insert into t_res values ('10 duplicate submission refused', case when sqlerrm like '%already added%' then 'PASS' else 'FAIL '||sqlerrm end); end;
end $$;
do $$ declare rep text; begin select string_agg(t.n||' => '||t.r, E'\n' order by t.n) into rep from t_res t; raise exception E'RESULTS\n%', rep; end $$;
rollback;
