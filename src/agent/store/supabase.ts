import { ConflictError, NotFoundError } from '../core/errors';
import { newId, nowIso } from '../core/util';
import type { Db } from './db';
import { TABLE_NAMES } from './db';
import type { NewRow, Row, Table, Where } from './table';

/**
 * Minimal structural type for supabase-js so this module needs no hard dependency.
 * Pass `createClient(url, SERVICE_ROLE_KEY)` from the server only: the agent runs
 * server-side and enforces authorization itself; RLS protects direct client access.
 * NOTE: written against the interface, not yet exercised against a live project
 * (connecting Supabase is an operations-stage step).
 */
export interface SupabaseLike {
  from(table: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const SQL_NAME: Record<(typeof TABLE_NAMES)[number], string> = {
  businesses: 'sc_businesses', sites: 'sc_sites', members: 'sc_members', profiles: 'sc_profiles', scans: 'sc_scans',
  research: 'sc_research', findings: 'sc_findings', cards: 'sc_cards', deliverables: 'sc_deliverables',
  strategies: 'sc_strategies', campaigns: 'sc_campaigns', executionRequests: 'sc_execution_requests',
  metrics: 'sc_metrics', reports: 'sc_reports', workflows: 'sc_workflows', audit: 'sc_audit', usage: 'sc_usage',
  uses: 'sc_uses', billing: 'sc_billing', stripeEvents: 'sc_stripe_events', previews: 'sc_previews',
};

const CORE = ['id', 'businessId', 'version', 'createdAt', 'updatedAt'] as const;

export class SupabaseTable<T extends Row> implements Table<T> {
  constructor(private readonly client: SupabaseLike, private readonly name: string) {}

  private toRow(r: any): T { // eslint-disable-line @typescript-eslint/no-explicit-any
    return { ...r.data, id: r.id, businessId: r.business_id, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at } as T;
  }
  private strip(o: object): Record<string, unknown> {
    const d: Record<string, unknown> = { ...(o as Record<string, unknown>) };
    for (const k of CORE) delete d[k];
    return d;
  }
  async insert(row: NewRow<T>): Promise<T> {
    const t = nowIso();
    const id = row.id ?? newId();
    const { data, error } = await this.client.from(this.name)
      .insert({ id, business_id: row.businessId, version: 1, created_at: t, updated_at: t, data: this.strip(row) })
      .select().single();
    if (error) throw new ConflictError(error.message, 'db_error');
    return this.toRow(data);
  }
  async get(businessId: string, id: string): Promise<T | undefined> {
    const { data, error } = await this.client.from(this.name).select().eq('business_id', businessId).eq('id', id).maybeSingle();
    if (error) throw new ConflictError(error.message, 'db_error');
    return data ? this.toRow(data) : undefined;
  }
  async require(businessId: string, id: string): Promise<T> {
    const r = await this.get(businessId, id);
    if (!r) throw new NotFoundError(this.name);
    return r;
  }
  async list(businessId: string, where?: Where, opts: { limit?: number; newestFirst?: boolean } = {}): Promise<T[]> {
    let q = this.client.from(this.name).select().eq('business_id', businessId);
    if (where && Object.keys(where).length) q = q.contains('data', where);
    q = q.order('created_at', { ascending: !opts.newestFirst });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new ConflictError(error.message, 'db_error');
    return (data ?? []).map((r: unknown) => this.toRow(r));
  }
  async listAcross(where: Where, opts: { limit?: number; newestFirst?: boolean } = {}): Promise<T[]> {
    let q = this.client.from(this.name).select().contains('data', where).order('created_at', { ascending: !opts.newestFirst });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new ConflictError(error.message, 'db_error');
    return (data ?? []).map((r: unknown) => this.toRow(r));
  }
  async update(businessId: string, id: string, patch: Partial<Omit<T, keyof Row>>, expectedVersion?: number): Promise<T> {
    const cur = await this.require(businessId, id);
    if (expectedVersion !== undefined && cur.version !== expectedVersion)
      throw new ConflictError(`${this.name} was modified concurrently`, 'version_conflict');
    // Compare-and-set on version so concurrent writers cannot both win.
    const { data, error } = await this.client.from(this.name)
      .update({ data: this.strip({ ...cur, ...patch }), version: cur.version + 1, updated_at: nowIso() })
      .eq('business_id', businessId).eq('id', id).eq('version', cur.version).select().maybeSingle();
    if (error) throw new ConflictError(error.message, 'db_error');
    if (!data) throw new ConflictError(`${this.name} was modified concurrently`, 'version_conflict');
    return this.toRow(data);
  }
}

export function createSupabaseDb(client: SupabaseLike): Db {
  return Object.fromEntries(TABLE_NAMES.map((n) => [n, new SupabaseTable(client, SQL_NAME[n])])) as unknown as Db;
}
