import { describe, expect, it } from 'vitest';
import { SupabaseTable, type SupabaseLike } from '../src/agent/store/supabase';
import type { Row } from '../src/agent/store/table';

interface R extends Row { n?: number; tag?: string }
type DbRow = { id: string; business_id: string; version: number; created_at: string; updated_at: string; data: Record<string, unknown> };

/** A small PostgREST-shaped fake: filters, ordering, paging, a 1000-row response cap, unique ids, and switchable RLS denial. */
function fake(opts: { denyInsert?: boolean; denyUpdate?: boolean; cap?: number } = {}) {
  const rows: DbRow[] = []; const calls = { selects: 0 };
  const cap = opts.cap ?? 1000;
  class B implements PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> {
    private f: ((r: DbRow) => boolean)[] = []; private mode: 'select' | 'insert' | 'update' = 'select'; private payload: any; private lo = 0; private hi = Infinity; private ord: string[] = [];
    select() { if (this.mode === 'select') calls.selects++; return this; } insert(p: any) { this.mode = 'insert'; this.payload = p; return this; } update(p: any) { this.mode = 'update'; this.payload = p; return this; }
    eq(c: string, v: unknown) { this.f.push((r) => (r as any)[c] === v); return this; }
    contains(_c: string, obj: Record<string, unknown>) { this.f.push((r) => Object.entries(obj).every(([k, v]) => JSON.stringify(r.data[k]) === JSON.stringify(v))); return this; }
    order(c: string) { this.ord.push(c); return this; } limit() { return this; } range(a: number, b: number) { this.lo = a; this.hi = Math.min(b, a + cap - 1); return this; }
    private run() {
      if (this.mode === 'insert') {
        if (opts.denyInsert) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
        if (rows.some((r) => r.id === this.payload.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        const row = { ...this.payload } as DbRow; rows.push(row); return { data: row, error: null };
      }
      const m = rows.filter((r) => this.f.every((fn) => fn(r)));
      if (this.mode === 'update') { if (opts.denyUpdate || !m[0]) return { data: null, error: null }; Object.assign(m[0], this.payload); return { data: m[0], error: null }; }
      const sorted = [...m].sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at < b.created_at ? -1 : 1));
      return { data: sorted.slice(this.lo, this.hi === Infinity ? undefined : this.hi + 1), error: null };
    }
    single() { const r = this.run(); return Promise.resolve(r.error ? r : { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null }); }
    maybeSingle() { const r = this.run(); return Promise.resolve(r.error ? r : { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: null }); }
    then<A, Z>(ok?: (v: any) => A | PromiseLike<A>, bad?: (e: unknown) => Z | PromiseLike<Z>) { return Promise.resolve(this.run()).then(ok, bad); }
  }
  const client: SupabaseLike = { from: () => new B() };
  return { client, rows, calls };
}
const mk = (o?: Parameters<typeof fake>[0]) => { const f = fake(o); return { ...f, t: new SupabaseTable<R>(f.client, 'sc_test') }; };

describe('Supabase table adapter', () => {
  it('maps a duplicate id to the conflict error the rest of the app handles (idempotent inserts)', async () => {
    const { t } = mk(); await t.insert({ id: 'a', businessId: 'b1', n: 1 } as never); await expect(t.insert({ id: 'a', businessId: 'b1', n: 2 } as never)).rejects.toMatchObject({ code: 'conflict', status: 409 });
  });
  it('maps row-level-security refusal on insert to Forbidden, not a generic error', async () => {
    await expect(mk({ denyInsert: true }).t.insert({ businessId: 'b1' } as never)).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });
  it('lists beyond the 1000-row response cap (pages through, never silently truncates)', async () => {
    const { t, rows } = mk(); for (let i = 0; i < 2350; i++) rows.push({ id: `id${String(i).padStart(5, '0')}`, business_id: 'b1', version: 1, created_at: new Date(1e12 + i).toISOString(), updated_at: '', data: {} });
    rows.push({ id: 'other', business_id: 'b2', version: 1, created_at: new Date(1e12).toISOString(), updated_at: '', data: {} });
    const all = await t.list('b1'); expect(all).toHaveLength(2350); expect(new Set(all.map((r) => r.id)).size).toBe(2350); expect(all.every((r) => r.businessId === 'b1')).toBe(true);
    expect(await t.list('b1', undefined, { limit: 1500 })).toHaveLength(1500); expect(await t.list('b1', undefined, { limit: 10 })).toHaveLength(10);
  });
  it('tenant scoping is part of every query', async () => { const { t } = mk(); await t.insert({ id: 'x', businessId: 'b1' } as never); expect(await t.get('b2', 'x')).toBeUndefined(); expect(await t.list('b2')).toEqual([]); await expect(t.update('b2', 'x', {} as never)).rejects.toMatchObject({ status: 404 }); });
  it('optimistic concurrency: of N simultaneous updates from the same version exactly one wins, the rest conflict', async () => {
    const { t } = mk(); const r = await t.insert({ id: 'c', businessId: 'b1', n: 0 } as never);
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => t.update('b1', 'c', { n: i + 1 } as never, r.version)));
    // the fake is single-threaded, so after the first write the others see version 2 and are refused up front
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1); expect(results.filter((x) => x.status === 'rejected').every((x) => (x as PromiseRejectedResult).reason.code === 'version_conflict')).toBe(true);
    expect((await t.require('b1', 'c')).version).toBe(2);
  });
  it('a lost compare-and-set race (row changed between read and write) is a version conflict', async () => {
    const { t, rows } = mk(); const r = await t.insert({ id: 'd', businessId: 'b1', n: 0 } as never);
    // someone else bumps the version after our read but before our write
    const origRequire = t.require.bind(t); let first = true; (t as any).require = async (b: string, i: string) => { const got = await origRequire(b, i); if (first) { first = false; rows[0]!.version = 2; } return got; };
    await expect(t.update('b1', 'd', { n: 5 } as never)).rejects.toMatchObject({ code: 'version_conflict' }); expect(r.version).toBe(1);
  });
  it('RLS-filtered update (visible row, same version, zero rows written) is Forbidden, not a phantom conflict', async () => {
    const { t } = mk({ denyUpdate: true }); await t.insert({ id: 'e', businessId: 'b1' } as never);
    await expect(t.update('b1', 'e', { n: 1 } as never)).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });
});
