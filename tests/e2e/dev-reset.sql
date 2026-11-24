-- Clears the data the e2e journey creates (clicky-dev ONLY; keeps the e2e users). Run before each journey run.
-- Guard: you must opt in for the session first:   set app.allow_e2e_seed = 'on';
do $$ begin
  if coalesce(current_setting('app.allow_e2e_seed', true), '') <> 'on' then
    raise exception 'Refusing to reset: this is for clicky-dev only. Run  set app.allow_e2e_seed = ''on'';  first.';
  end if;
end $$;
with e2e as (select id from auth.users where email like '%@e2e.test'),
del_orgs as (delete from public.organizations where created_by in (select id from e2e) returning id),
del_prev as (delete from public.previews where claimed_by in (select id from e2e) or email like '%@e2e.test'
  or domain like 'claim-%' or domain like 'wrongmail-%' or domain like 'sunrise-%' or domain like 'nowhere-%' or domain like 'fast.%' returning id),
del_fb as (delete from public.feedback returning id)
select (select count(*) from del_orgs) orgs_deleted, (select count(*) from del_prev) previews_deleted, (select count(*) from del_fb) feedback_deleted;
