-- DRAFT: NOT APPLIED anywhere. Superseded pending the schema-consolidation decision in docs/SCHEMA_CONSOLIDATION.md. Do not apply as-is:
-- it is built on the sc_members table, which the consolidation proposes to replace with the existing organization_members.

-- Customer-session writes. The app can run entirely under each customer's own Supabase session (publishable key + the
-- customer's JWT); no service-role key is required for normal customer operations. This migration is what makes that safe:
-- the DATABASE enforces tenant membership and role on every write, so the app's own checks are defence in depth, not the only gate.
--
-- Roles (sc_members.data->>'role'):  owner > admin > editor > viewer
--   viewer: read only.   editor: write working data (profile, scans, findings, cards, drafts, plans, campaigns, results, runs).
--   admin: + authorize/execute actions.   owner: + manage members.
-- Never writable by any customer session: sc_billing, sc_stripe_events, sc_previews (they need a trusted server credential).
-- No customer session can DELETE anything.
--
-- Known limit (by design, documented): RLS checks WHO may write WHERE; it cannot validate business rules inside the JSON
-- (state machines, approval logic). Those are enforced by the app server. A member calling the Data API directly can write
-- any state within their role's tables, but never across tenants and never above their role.

-- ---------- row integrity (all tenant tables) ----------
create or replace function sc_private.guard_row() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.version <> 1 then raise exception 'new rows must start at version 1' using errcode = '23514'; end if;
    new.created_at := now(); new.updated_at := now();
  else
    if new.id <> old.id or new.business_id <> old.business_id then raise exception 'id and business_id are immutable' using errcode = '23514'; end if;
    if new.version <> old.version + 1 then raise exception 'version must increase by exactly 1 (optimistic concurrency)' using errcode = '23514'; end if;
    new.created_at := old.created_at; new.updated_at := now();
  end if;
  return new;
end $$;

-- ---------- helpers ----------
-- True when `bid` is a business with NO members yet whose recorded owner is the caller: the one-time bootstrap of a new workspace.
create or replace function sc_private.can_bootstrap(bid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sc_businesses b where b.id = bid and b.data->>'ownerId' = auth.uid()::text)
     and not exists (select 1 from public.sc_members m where m.business_id = bid);
$$;
revoke all on function sc_private.can_bootstrap(text) from public, anon;
grant execute on function sc_private.can_bootstrap(text) to authenticated;

-- ---------- apply integrity triggers + working-data policies ----------
do $$
declare t text;
begin
  foreach t in array array['sc_businesses','sc_sites','sc_members','sc_profiles','sc_scans','sc_research','sc_findings','sc_cards','sc_deliverables','sc_strategies','sc_campaigns','sc_execution_requests','sc_metrics','sc_reports','sc_workflows','sc_audit','sc_usage','sc_uses','sc_billing','sc_stripe_events','sc_previews'] loop
    execute format('drop trigger if exists sc_guard on public.%I', t);
    execute format('create trigger sc_guard before insert or update on public.%I for each row execute function sc_private.guard_row()', t);
  end loop;

  -- working data: owner/admin/editor may insert and update rows of their own business
  foreach t in array array['sc_sites','sc_profiles','sc_scans','sc_research','sc_findings','sc_cards','sc_deliverables','sc_strategies','sc_campaigns','sc_metrics','sc_reports','sc_workflows','sc_usage'] loop
    execute format('grant insert, update on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_editor_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (sc_private.has_role(business_id, array[''owner'',''admin'',''editor'']))', t || '_editor_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_editor_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (sc_private.has_role(business_id, array[''owner'',''admin'',''editor''])) with check (sc_private.has_role(business_id, array[''owner'',''admin'',''editor'']))', t || '_editor_update', t);
  end loop;
end $$;

-- ---------- businesses: any signed-in user may create their OWN; owner/admin may edit ----------
grant insert, update on public.sc_businesses to authenticated;
drop policy if exists sc_businesses_owner_select on public.sc_businesses;
create policy sc_businesses_owner_select on public.sc_businesses for select to authenticated using (data->>'ownerId' = auth.uid()::text); -- lets the creator read the row back before the membership exists
drop policy if exists sc_businesses_create on public.sc_businesses;
create policy sc_businesses_create on public.sc_businesses for insert to authenticated with check (id = business_id and data->>'ownerId' = auth.uid()::text);
drop policy if exists sc_businesses_admin_update on public.sc_businesses;
create policy sc_businesses_admin_update on public.sc_businesses for update to authenticated using (sc_private.has_role(id, array['owner','admin'])) with check (sc_private.has_role(id, array['owner','admin']) and data->>'ownerId' = (select b.data->>'ownerId' from public.sc_businesses b where b.id = sc_businesses.id));

-- ---------- members: bootstrap own ownership once; afterwards only owners add or change members ----------
grant insert, update on public.sc_members to authenticated;
drop policy if exists sc_members_bootstrap on public.sc_members;
create policy sc_members_bootstrap on public.sc_members for insert to authenticated
  with check (data->>'userId' = auth.uid()::text and data->>'role' = 'owner' and sc_private.can_bootstrap(business_id));
drop policy if exists sc_members_owner_insert on public.sc_members;
create policy sc_members_owner_insert on public.sc_members for insert to authenticated
  with check (sc_private.has_role(business_id, array['owner']) and data->>'role' in ('admin','editor','viewer'));
drop policy if exists sc_members_owner_update on public.sc_members;
create policy sc_members_owner_update on public.sc_members for update to authenticated
  using (sc_private.has_role(business_id, array['owner']) and data->>'role' <> 'owner')
  with check (sc_private.has_role(business_id, array['owner']) and data->>'role' in ('admin','editor','viewer'));

-- ---------- execution requests: editors may REQUEST (status must start as 'requested'); only owner/admin may change status ----------
grant insert, update on public.sc_execution_requests to authenticated;
drop policy if exists sc_execution_requests_insert on public.sc_execution_requests;
create policy sc_execution_requests_insert on public.sc_execution_requests for insert to authenticated
  with check (sc_private.has_role(business_id, array['owner','admin','editor']) and data->>'status' = 'requested' and not (data ? 'authorization'));
drop policy if exists sc_execution_requests_admin_update on public.sc_execution_requests;
create policy sc_execution_requests_admin_update on public.sc_execution_requests for update to authenticated
  using (sc_private.has_role(business_id, array['owner','admin'])) with check (sc_private.has_role(business_id, array['owner','admin']));

-- ---------- audit: append-only; a member may add rows for their business. Rows that claim a USER actor must be that user. ----------
grant insert on public.sc_audit to authenticated;
drop policy if exists sc_audit_member_insert on public.sc_audit;
create policy sc_audit_member_insert on public.sc_audit for insert to authenticated
  with check (sc_private.is_member(business_id) and (data->>'actorType' <> 'user' or data->>'actorId' = auth.uid()::text));

-- ---------- uses (allowance ledger): a member may add their OWN rows; never update or delete ----------
grant insert on public.sc_uses to authenticated;
drop policy if exists sc_uses_self_insert on public.sc_uses;
create policy sc_uses_self_insert on public.sc_uses for insert to authenticated
  with check (sc_private.has_role(business_id, array['owner','admin','editor']) and data->>'userId' = auth.uid()::text);

-- sc_billing, sc_stripe_events, sc_previews: deliberately NO customer write policy and no write grant.
