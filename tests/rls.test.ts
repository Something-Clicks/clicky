import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222';
let db: PGlite;
const as = async (uid: string | null, fn: () => Promise<unknown>) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false);`);
  try { return await fn(); } finally { await db.exec('reset role'); }
};
const rows = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;

beforeAll(async () => {
  db = new PGlite();
  // Minimal Supabase emulation: roles and auth.uid() backed by the JWT-claim GUC, as PostgREST does.
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  await db.exec(readFileSync('supabase/migrations/0001_schema.sql', 'utf8'));
  await db.exec(`
    insert into sc_businesses (id, business_id, data) values ('biz-a','biz-a','{"name":"A"}'), ('biz-b','biz-b','{"name":"B"}');
    insert into sc_members (id, business_id, data) values ('m1','biz-a','{"userId":"${A}","role":"owner"}'), ('m2','biz-b','{"userId":"${B}","role":"owner"}'), ('m3','biz-a','{"userId":"${B}","role":"viewer"}');
    delete from sc_members where id='m3';
    insert into sc_cards (id, business_id, data) values ('c-a','biz-a','{"t":1}'), ('c-b','biz-b','{"t":2}');
    insert into sc_audit (id, business_id, data) values ('au-a','biz-a','{}');
    insert into sc_previews (id, business_id, data) values ('p1','public','{"url":"x"}');
    insert into sc_stripe_events (id, business_id, data) values ('e1','public','{}');
  `);
});

describe('Supabase RLS (tenant isolation)', () => {
  it('a member reads only their own business data', async () => {
    const r = await as(A, () => rows('select id from sc_cards order by id'));
    expect(r).toEqual([{ id: 'c-a' }]);
    expect(await as(B, () => rows('select id from sc_cards'))).toEqual([{ id: 'c-b' }]);
    expect(await as(A, () => rows('select id from sc_businesses'))).toEqual([{ id: 'biz-a' }]);
  });
  it('a user with no membership sees nothing; an unauthenticated caller sees nothing', async () => {
    expect(await as('33333333-3333-3333-3333-333333333333', () => rows('select id from sc_cards'))).toEqual([]);
    expect(await as(null, () => rows('select id from sc_cards'))).toEqual([]);
  });
  it('clients cannot write at all (insert / update / delete are rejected)', async () => {
    await expect(as(A, () => db.exec(`insert into sc_cards (id, business_id, data) values ('x','biz-a','{}')`))).rejects.toThrow(/permission denied/i);
    await expect(as(A, () => db.exec(`update sc_cards set data='{"hacked":true}' where id='c-a'`))).rejects.toThrow(/permission denied/i);
    await expect(as(A, () => db.exec(`delete from sc_cards where id='c-a'`))).rejects.toThrow(/permission denied/i);
    await expect(as(A, () => db.exec(`insert into sc_cards (id, business_id, data) values ('x','biz-b','{}')`))).rejects.toThrow(/permission denied/i);
  });
  it('previews and stripe events are not readable by clients', async () => {
    await expect(as(A, () => rows('select * from sc_previews'))).rejects.toThrow(/permission denied/i);
    await expect(as(A, () => rows('select * from sc_stripe_events'))).rejects.toThrow(/permission denied/i);
    await expect(as(null, () => rows('select * from sc_previews'))).rejects.toThrow(/permission denied/i);
  });
  it('audit log is visible to owners/admins only', async () => {
    expect(await as(A, () => rows('select id from sc_audit'))).toEqual([{ id: 'au-a' }]);
    await db.exec(`insert into sc_members (id, business_id, data) values ('m4','biz-a','{"userId":"${B}","role":"viewer"}')`);
    expect(await as(B, () => rows(`select id from sc_audit where business_id='biz-a'`))).toEqual([]);
    expect(await as(B, () => rows(`select id from sc_cards where business_id='biz-a'`))).toEqual([{ id: 'c-a' }]); // viewers can read business data
    await db.exec(`delete from sc_members where id='m4'`);
  });
  it('a member cannot read another business through the membership table', async () => {
    expect(await as(A, () => rows('select id from sc_members'))).toEqual([{ id: 'm1' }]);
  });
});
