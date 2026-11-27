import { beforeEach, describe, expect, it } from 'vitest';
import { cachedCatalog, EXPECTED, resetCatalogCache, verifyCatalog, type CatalogKey, type StripeLike } from '../src/server/billing/catalog';

const IDS = Object.fromEntries((Object.keys(EXPECTED) as CatalogKey[]).map((k) => [k, `price_${k.replace(/\W/g, '_')}`])) as Record<CatalogKey, string>;
type P = { active?: boolean; livemode?: boolean; currency?: string; unit_amount?: number; type?: string; interval?: string; interval_count?: number; productName?: string; productActive?: boolean };
/** A fake Stripe account whose prices match the approved catalog unless overridden per key. */
function fake(over: Partial<Record<CatalogKey, P | 'missing' | 'error'>> = {}, mode: 'test' | 'live' | 'unknown' = 'test'): StripeLike {
  return {
    balance: { retrieve: async () => { if (mode === 'unknown') throw new Error('restricted'); return { livemode: mode === 'live' }; } },
    prices: { retrieve: async (id: string) => {
      const key = (Object.keys(IDS) as CatalogKey[]).find((k) => IDS[k] === id)!; const o = over[key]; const w = EXPECTED[key];
      if (o === 'missing') throw new Error(`No such price: '${id}'`); if (o === 'error') throw new Error('network down');
      const p = (o ?? {}) as P;
      return { id, active: p.active ?? true, livemode: p.livemode ?? (mode === 'live'), currency: p.currency ?? 'usd', unit_amount: p.unit_amount ?? w.amount, type: p.type ?? (w.kind === 'one_time' ? 'one_time' : 'recurring'),
        recurring: w.kind === 'one_time' ? null : { interval: p.interval ?? w.kind, interval_count: p.interval_count ?? 1 }, product: { id: 'prod_x', name: p.productName ?? w.productName, active: p.productActive ?? true } } as never;
    } },
  };
}
const run = (c: StripeLike, ids: Partial<Record<CatalogKey, string>> = IDS, production = false) => verifyCatalog(c, ids, { production });
const reason = (cs: Awaited<ReturnType<typeof run>>, k: CatalogKey) => cs.find((c) => c.key === k)!.reason;

describe('Stripe catalog verification (fails closed)', () => {
  beforeEach(resetCatalogCache);
  it('accepts exactly the approved catalog: names, prices, intervals', async () => { const cs = await run(fake()); expect(cs.every((c) => c.ok)).toBe(true); expect(cs).toHaveLength(7); });
  it('the approved amounts are $49, $79/$756, $179/$1,716, $399/$3,828', () => {
    expect(Object.fromEntries(Object.entries(EXPECTED).map(([k, v]) => [k, v.amount / 100]))).toEqual({ marketing_report: 49, 'marketing_assistant:month': 79, 'marketing_assistant:year': 756, 'marketing_studio:month': 179, 'marketing_studio:year': 1716, 'marketing_suite:month': 399, 'marketing_suite:year': 3828 });
  });
  it('an unset id is not purchasable', async () => { expect(reason(await run(fake(), { ...IDS, 'marketing_suite:year': undefined }), 'marketing_suite:year')).toMatch(/no price id/); });
  it('a price that does not exist in this mode is not purchasable', async () => { expect(reason(await run(fake({ marketing_report: 'missing' })), 'marketing_report')).toMatch(/not found in test mode/); });
  it('an API failure disables checkout instead of assuming the price is fine', async () => { expect(reason(await run(fake({ 'marketing_studio:month': 'error' })), 'marketing_studio:month')).toMatch(/lookup failed/); });
  it.each([
    ['wrong amount', { unit_amount: 7_800 }, /amount is 7800/], ['wrong currency', { currency: 'eur' }, /currency/], ['archived price', { active: false }, /archived/],
    ['wrong interval', { interval: 'year' }, /interval/], ['multi-month interval', { interval_count: 3 }, /interval/], ['archived product', { productActive: false }, /product is archived/],
    ['wrong product name (e.g. the old "Marketing")', { productName: 'Marketing' }, /expected "Marketing Assistant"/],
  ] as const)('rejects: %s', async (_n, over, re) => { expect(reason(await run(fake({ 'marketing_assistant:month': over })), 'marketing_assistant:month')).toMatch(re); });
  it('a one-time price must not be recurring and vice versa', async () => {
    expect(reason(await run(fake({ marketing_report: { type: 'recurring' } })), 'marketing_report')).toMatch(/type\/interval/);
    expect(reason(await run(fake({ 'marketing_suite:year': { type: 'one_time' } })), 'marketing_suite:year')).toMatch(/type\/interval/);
  });
  it('a live price under a test key (or the reverse) is rejected', async () => { expect(reason(await run(fake({ marketing_report: { livemode: true } })), 'marketing_report')).toMatch(/live mode but the key is test/); });
  it('live keys are refused outside production, allowed in production; unknown mode fails closed', async () => {
    expect((await run(fake({}, 'live'), IDS, false)).every((c) => !c.ok)).toBe(true); expect((await run(fake({}, 'live'), IDS, true)).every((c) => c.ok)).toBe(true);
    expect((await run(fake({}, 'unknown'))).every((c) => !c.ok)).toBe(true);
  });
  it('one bad price does not disable the others', async () => { const cs = await run(fake({ 'marketing_suite:month': { unit_amount: 1 } })); expect(cs.filter((c) => c.ok)).toHaveLength(6); });
  it('results are cached, and failures are re-checked sooner than successes', async () => {
    let calls = 0; const ok = async () => (calls++, [{ key: 'marketing_report' as const, ok: true }]); const bad = async () => (calls++, [{ key: 'marketing_report' as const, ok: false }]);
    await cachedCatalog(ok, 300_000, 0); await cachedCatalog(ok, 300_000, 200_000); expect(calls).toBe(1); await cachedCatalog(ok, 300_000, 400_000); expect(calls).toBe(2);
    resetCatalogCache(); await cachedCatalog(bad, 300_000, 0); await cachedCatalog(bad, 300_000, 20_000); expect(calls).toBe(3); await cachedCatalog(bad, 300_000, 40_000); expect(calls).toBe(4);
    resetCatalogCache(); const thrown = await cachedCatalog(async () => { throw new Error('boom'); }); expect(thrown.every((c) => !c.ok)).toBe(true);
  });
});
