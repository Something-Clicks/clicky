-- E2E test users for the clicky-dev Supabase project (ref ofstvbgaoznipsiqbjjp) ONLY.
-- NEVER run on production: it creates accounts with a known password and one platform admin.
-- Guard: you must opt in for the session first:   set app.allow_e2e_seed = 'on';
-- After testing, the accounts are disabled (banned_until). To re-enable before a run:
--   update auth.users set banned_until = null where email like '%@e2e.test';
-- Creates 12 confirmed users: {pat,other,buyer,mpbuyer,admin,nobody}-{m,d}@e2e.test (m = phone run, d = desktop run).
do $$
declare
  s text; r text; uid uuid; em text;
begin
  if coalesce(current_setting('app.allow_e2e_seed', true), '') <> 'on' then
    raise exception 'Refusing to seed: this is for clicky-dev only. Run  set app.allow_e2e_seed = ''on'';  first.';
  end if;
  foreach s in array array['m','d'] loop
    foreach r in array array['pat','other','buyer','mpbuyer','admin','nobody'] loop
      em := r || '-' || s || '@e2e.test';
      if exists (select 1 from auth.users where email = em) then continue; end if;
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
        extensions.crypt('E2e-Passw0rd!7', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', initcap(r) || ' E2E'), now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at)
      values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true, 'phone_verified', false), 'email', uid::text, now(), now(), now());
      if r = 'admin' then insert into public.platform_admins (user_id, note) values (uid, 'e2e test admin'); end if;
    end loop;
  end loop;
end $$;
