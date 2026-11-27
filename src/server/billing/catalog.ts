import type Stripe from 'stripe';

/** The approved catalog. A configured price id is usable ONLY if Stripe confirms it matches this exactly. */
export type CatalogKey = 'marketing_report' | 'marketing_assistant:month' | 'marketing_assistant:year' | 'marketing_studio:month' | 'marketing_studio:year' | 'marketing_suite:month' | 'marketing_suite:year';
export const EXPECTED: Record<CatalogKey, { productName: string; amount: number; kind: 'one_time' | 'month' | 'year' }> = {
  marketing_report: { productName: 'Marketing Report', amount: 4_900, kind: 'one_time' },
  'marketing_assistant:month': { productName: 'Marketing Assistant', amount: 7_900, kind: 'month' },
  'marketing_assistant:year': { productName: 'Marketing Assistant', amount: 75_600, kind: 'year' },
  'marketing_studio:month': { productName: 'Marketing Studio', amount: 17_900, kind: 'month' },
  'marketing_studio:year': { productName: 'Marketing Studio', amount: 171_600, kind: 'year' },
  'marketing_suite:month': { productName: 'Marketing Suite', amount: 39_900, kind: 'month' },
  'marketing_suite:year': { productName: 'Marketing Suite', amount: 382_800, kind: 'year' },
};
export const keyOf = (product: string, interval: 'month' | 'year' = 'month'): CatalogKey => (product === 'marketing_report' ? 'marketing_report' : (`${product}:${interval}` as CatalogKey));

export interface PriceCheck { key: CatalogKey; priceId?: string; ok: boolean; reason?: string }
/** The slice of the Stripe client this needs (lets tests use a fake). */
export interface StripeLike {
  prices: { retrieve(id: string, o: { expand: string[] }): Promise<Stripe.Price> };
  balance: { retrieve(): Promise<{ livemode: boolean }> };
}

/** Mode of the CONFIGURED KEY (what the account actually is), falling back to the key prefix. */
export async function detectMode(client: StripeLike, key?: string): Promise<'test' | 'live' | 'unknown'> {
  try { return (await client.balance.retrieve()).livemode ? 'live' : 'test'; } catch { /* restricted key may lack balance access */ }
  if (key && /^(sk|rk)_test_/.test(key)) return 'test'; if (key && /^(sk|rk)_live_/.test(key)) return 'live';
  return 'unknown';
}

/**
 * Verifies every configured id against Stripe. FAILS CLOSED: unset id, API error, wrong amount/currency/interval, inactive price or
 * product, a product whose name is not the approved name, a mode mismatch, or a live key outside production all mean "not purchasable".
 */
export async function verifyCatalog(client: StripeLike, ids: Partial<Record<CatalogKey, string | undefined>>, o: { production: boolean; key?: string }): Promise<PriceCheck[]> {
  const mode = await detectMode(client, o.key);
  return Promise.all((Object.keys(EXPECTED) as CatalogKey[]).map(async (key): Promise<PriceCheck> => {
    const priceId = ids[key]; const fail = (reason: string): PriceCheck => ({ key, priceId, ok: false, reason });
    if (!priceId) return fail('no price id configured');
    if (mode === 'unknown') return fail('could not determine whether the Stripe key is test or live');
    if (mode === 'live' && !o.production) return fail('a live-mode Stripe key is not allowed outside production');
    let p: Stripe.Price;
    try { p = await client.prices.retrieve(priceId, { expand: ['product'] }); }
    catch (e) { const m = (e as Error).message ?? ''; return fail(/No such price/i.test(m) ? `price not found in ${mode} mode` : `Stripe lookup failed: ${m.slice(0, 80)}`); }
    const want = EXPECTED[key]; const prod = typeof p.product === 'object' && p.product && !('deleted' in p.product && p.product.deleted) ? (p.product as Stripe.Product) : undefined;
    if (p.livemode !== (mode === 'live')) return fail(`price is ${p.livemode ? 'live' : 'test'} mode but the key is ${mode} mode`);
    if (!p.active) return fail('price is archived/inactive');
    if (p.currency !== 'usd') return fail(`currency is ${p.currency}, expected usd`);
    if (p.unit_amount !== want.amount) return fail(`amount is ${p.unit_amount}, expected ${want.amount}`);
    if (want.kind === 'one_time' ? p.type !== 'one_time' : p.type !== 'recurring' || p.recurring?.interval !== want.kind || (p.recurring?.interval_count ?? 1) !== 1) return fail(`billing type/interval does not match ${want.kind}`);
    if (!prod) return fail('product could not be read');
    if (!prod.active) return fail('product is archived/inactive');
    if (prod.name.trim().toLowerCase() !== want.productName.toLowerCase()) return fail(`product is named "${prod.name}", expected "${want.productName}"`);
    return { key, priceId, ok: true };
  }));
}

/** Cached verification so pages do not call Stripe on every request. Failures are cached briefly. */
let cache: { at: number; checks: PriceCheck[] } | undefined;
export async function cachedCatalog(load: () => Promise<PriceCheck[]>, ttlMs = 5 * 60_000, now = Date.now()): Promise<PriceCheck[]> {
  if (cache && now - cache.at < (cache.checks.every((c) => c.ok) ? ttlMs : 30_000)) return cache.checks;
  const checks = await load().catch((e) => (Object.keys(EXPECTED) as CatalogKey[]).map((key) => ({ key, ok: false, reason: `verification failed: ${(e as Error).message.slice(0, 60)}` })));
  cache = { at: now, checks }; return checks;
}
export const resetCatalogCache = () => { cache = undefined; };
