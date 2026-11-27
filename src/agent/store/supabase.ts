import { ConflictError, ForbiddenError, NotFoundError } from '../core/errors';
import { newId, nowIso } from '../core/util';
import type { Db } from './db';
import { TABLE_NAMES } from './db';
import type { NewRow, Row, Table, Where } from './table';
import { BillingView, MemberTable, OrganizationTable, ServerOnlyTable } from './org';

/**
 * Minimal structural type for supabase-js so this module needs no hard dependency.
 * Pass `createClient(url, SERVICE_ROLE_KEY)` from the server only: the agent runs
 * server-side and enforces authorization itself; RLS protects direct client access.
 * NOTE: written against the interface, not yet exercised against a live project
 * (connecting Supabase is an operations-stage step).
 */
export interface SupabaseLike {
  from(table: string): any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const SQL_NAME: Record<(typeof TABLE_NAMES)[number], string> = {
  businesses: '', sites: 'sc_sites', members: '', profiles: 'sc_profiles', scans: 'sc_scans',
  research: 'sc_research', findings: 'sc_findings', cards: 'sc_cards', deliverables: 'sc_deliverables',
  strategies: 'sc_strategies', campaigns: 'sc_campaigns', executionRequests: 'sc_execution_requests',
  metrics: 'sc_metrics', reports: 'sc_reports', workflows: 'sc_workflows', audit: 'sc_audit', usage: 'sc_usage',
  uses: 'sc_uses', billing: '', stripeEvents: '', previews: '',
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
    if (error) throw this.fail(error);
    return this.toRow(data);
  }
  /** Postgres errors become the same application errors the rest of the code already handles. */
  private fail(error: { code?: string; message: string }): Error {
    if (error.code === '23505') return new ConflictError(`${this.name} already exists`, 'conflict');
    if (error.code === '42501') return new ForbiddenError('You do not have permission to do that', 'forbidden');
    if (error.code === '23514') return new ConflictError(error.message, 'integrity_violation');
    return new ConflictError(error.message, 'db_error');
  }
  async get(businessId: string, id: string): Promise<T | undefined> {
    const { data, error } = await this.client.from(this.name).select().eq('business_id', businessId).eq('id', id).maybeSingle();
    if (error) throw this.fail(error);
    return data ? this.toRow(data) : undefined;
  }
  async require(businessId: string, id: string): Promise<T> {
    const r = await this.get(businessId, id);
    if (!r) throw new NotFoundError(this.name);
    return r;
  }
  /** PostgREST caps a response (default 1000 rows); page through so lists are never silently truncated. */
  private async page(build: () => any, limit?: number): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: T[] = []; const size = 1000;
    for (let from = 0; ; from += size) {
      const want = limit ? Math.min(size, limit - out.length) : size; if (want <= 0) break;
      const { data, error } = await build().range(from, from + want - 1);
      if (error) throw this.fail(error);
      out.push(...(data ?? []).map((r: unknown) => this.toRow(r))); if ((data ?? []).length < want) break;
    }
    return out;
  }
  async list(businessId: string, where?: Where, opts: { limit?: number; newestFirst?: boolean } = {}): Promise<T[]> {
    return this.page(() => {
      let q = this.client.from(this.name).select().eq('business_id', businessId);
      if (where && Object.keys(where).length) q = q.contains('data', where);
      return q.order('created_at', { ascending: !opts.newestFirst }).order('id');
    }, opts.limit);
  }
  async listAcross(where: Where, opts: { limit?: number; newestFirst?: boolean } = {}): Promise<T[]> {
    return this.page(() => this.client.from(this.name).select().contains('data', where).order('created_at', { ascending: !opts.newestFirst }).order('id'), opts.limit);
  }
  async update(businessId: string, id: string, patch: Partial<Omit<T, keyof Row>>, expectedVersion?: number): Promise<T> {
    const cur = await this.require(businessId, id);
    if (expectedVersion !== undefined && cur.version !== expectedVersion)
      throw new ConflictError(`${this.name} was modified concurrently`, 'version_conflict');
    // Compare-and-set on version so concurrent writers cannot both win.
    const { data, error } = await this.client.from(this.name)
      .update({ data: this.strip({ ...cur, ...patch }), version: cur.version + 1, updated_at: nowIso() })
      .eq('business_id', businessId).eq('id', id).eq('version', cur.version).select().maybeSingle();
    if (error) throw this.fail(error);
    if (data) return this.toRow(data);
    // No row came back: either someone else updated it first, or row-level security filtered the write out.
    const now = await this.get(businessId, id);
    if (!now) throw new NotFoundError(this.name);
    if (now.version !== cur.version) throw new ConflictError(`${this.name} was modified concurrently`, 'version_conflict');
    throw new ForbiddenError('You do not have permission to change this', 'forbidden');
  }
}

/**
 * A Db bound to ONE signed-in customer's session (supabase-js client created with the publishable key + the user's access token).
 * Tenancy, roles and billing come from the existing organizations / organization_members / subscriptions / purchases tables;
 * the agent's working data lives in sc_* tables. Every query is subject to row-level security.
 */
export function createSupabaseDb(client: SupabaseLike): Db {
  const orgs = new OrganizationTable(client);
  const own = Object.fromEntries(TABLE_NAMES.filter((n) => SQL_NAME[n]).map((n) => [n, new SupabaseTable(client, SQL_NAME[n])]));
  return { ...own, businesses: orgs, members: new MemberTable(client), billing: new BillingView(client),
    stripeEvents: new ServerOnlyTable('Stripe event processing'), previews: new ServerOnlyTable('Anonymous previews'),
    provision: (name: string, website?: string) => orgs.provision(name, website) } as unknown as Db;
}
