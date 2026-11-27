import { ConflictError, NotFoundError } from '../core/errors';
import { newId, nowIso } from '../core/util';

export interface Row { id: string; businessId: string; version: number; createdAt: string; updatedAt: string }
export type NewRow<T extends Row> = Omit<T, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { id?: string };
export type Where = Record<string, unknown>;

/**
 * Tenant-scoped async table. Every read/write takes a businessId, so isolation is
 * structural. Optimistic concurrency via `version` gives atomic state transitions
 * (duplicate-execution prevention). A Supabase adapter implements the same interface.
 */
export interface Table<T extends Row> {
  insert(row: NewRow<T>): Promise<T>;
  get(businessId: string, id: string): Promise<T | undefined>;
  require(businessId: string, id: string): Promise<T>;
  list(businessId: string, where?: Where, opts?: { limit?: number; newestFirst?: boolean }): Promise<T[]>;
  /** Service-level lookup across tenants (membership by user, Stripe customer -> billing). Never exposed to request handlers directly. */
  listAcross(where: Where, opts?: { limit?: number; newestFirst?: boolean }): Promise<T[]>;
  /** Merge-patch; if expectedVersion is given a mismatch throws ConflictError. */
  update(businessId: string, id: string, patch: Partial<Omit<T, keyof Row>>, expectedVersion?: number): Promise<T>;
}

const matches = (r: object, where?: Where): boolean =>
  !where || Object.entries(where).every(([k, v]) => JSON.stringify((r as Record<string, unknown>)[k]) === JSON.stringify(v));

export class InMemoryTable<T extends Row> implements Table<T> {
  private rows = new Map<string, T>();
  constructor(private readonly label = 'record') {}

  async insert(row: NewRow<T>): Promise<T> {
    const t = nowIso();
    const full = { ...row, id: row.id ?? newId(), version: 1, createdAt: t, updatedAt: t } as unknown as T;
    if (this.rows.has(full.id)) throw new ConflictError(`${this.label} ${full.id} already exists`);
    this.rows.set(full.id, structuredClone(full));
    return structuredClone(full);
  }
  async get(businessId: string, id: string): Promise<T | undefined> {
    const r = this.rows.get(id);
    return r && r.businessId === businessId ? structuredClone(r) : undefined;
  }
  async require(businessId: string, id: string): Promise<T> {
    const r = await this.get(businessId, id);
    if (!r) throw new NotFoundError(this.label);
    return r;
  }
  async list(businessId: string, where?: Where, opts: { limit?: number; newestFirst?: boolean } = {}): Promise<T[]> {
    let out = [...this.rows.values()].filter((r) => r.businessId === businessId && matches(r, where));
    out.sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? -1 : 1));
    if (opts.newestFirst) out.reverse();
    if (opts.limit) out = out.slice(0, opts.limit);
    return out.map((r) => structuredClone(r));
  }
  async listAcross(where: Where, opts: { limit?: number; newestFirst?: boolean } = {}): Promise<T[]> {
    let out = [...this.rows.values()].filter((r) => matches(r, where));
    out.sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? -1 : 1));
    if (opts.newestFirst) out.reverse();
    if (opts.limit) out = out.slice(0, opts.limit);
    return out.map((r) => structuredClone(r));
  }
  async update(businessId: string, id: string, patch: Partial<Omit<T, keyof Row>>, expectedVersion?: number): Promise<T> {
    const cur = this.rows.get(id);
    if (!cur || cur.businessId !== businessId) throw new NotFoundError(this.label);
    if (expectedVersion !== undefined && cur.version !== expectedVersion)
      throw new ConflictError(`${this.label} was modified concurrently`, 'version_conflict');
    const next = { ...cur, ...structuredClone(patch), version: cur.version + 1, updatedAt: nowIso() } as T;
    this.rows.set(id, next);
    return structuredClone(next);
  }
}
