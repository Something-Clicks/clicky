-- Supabase advisor 0028/0029: public.rls_auto_enable() (Supabase's helper behind the
-- ensure_rls event trigger, which turns on RLS for every new table) is SECURITY
-- DEFINER and executable by anon/authenticated through /rest/v1/rpc. It should not
-- be callable at all. Event triggers do not check EXECUTE, so ensure_rls keeps working.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- New functions are not executable by PUBLIC or the API roles unless a migration
-- grants it explicitly (every function in this project does).
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
