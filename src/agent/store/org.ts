import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../core/errors';
import type { BillingRow, BusinessRow, MemberRow } from '../domain/models';
import type { NewRow, Table, Where } from './table';
import type { SupabaseLike } from './supabase';

/**
 * Adapters over the EXISTING Supabase tenancy and billing tables, used with the signed-in customer's session (RLS applies).
 * businesses -> organizations + business_profiles; members -> organization_members (roles owner|member);
 * billing -> subscriptions + purchases (read-only for customers: only the Stripe webhook may write them).
 */
const OLD_TO_NEW: Record<string, 'report' | 'assistant' | 'studio' | 'suite' | undefined> = {
  report: 'report', marketing_plan: 'report', diagnostic_audit: 'report',
  assistant: 'assistant', single_site: 'assistant', studio: 'studio', business_plus: 'studio', suite: 'suite', multi_site: 'suite',
  // starter_ai, growth_ai, scale_automation: deliberately unmapped until their historical terms are confirmed.
};
export const canonicalPlan = (id: string) => OLD_TO_NEW[id];

abstract class Unsupported<T extends { id: string; businessId: string; version: number; createdAt: string; updatedAt: string }> {
  protected deny(what: string): never { throw new ForbiddenError(`${what} is managed by the server and cannot be changed from a customer session`, 'server_only'); }
  async insert(_r: NewRow<T>): Promise<T> { return this.deny('This record'); }
  async require(businessId: string, id: string): Promise<T> { const r = await (this as unknown as Table<T>).get(businessId, id); if (!r) throw new NotFoundError('record'); return r; }
}

export class OrganizationTable extends Unsupported<BusinessRow> implements Table<BusinessRow> {
  constructor(private readonly c: SupabaseLike) { super(); }
  private row(o: { id: string; name: string; created_by: string | null; created_at: string; updated_at: string }, website?: string | null): BusinessRow {
    return { id: o.id, businessId: o.id, name: o.name, ownerId: o.created_by ?? '', website: website ?? undefined, version: 1, createdAt: o.created_at, updatedAt: o.updated_at };
  }
  /** Creates the organization, the owner membership and the profile row in one database call (existing RPC). */
  async provision(name: string, website?: string): Promise<string> {
    const { data, error } = await this.c.rpc('create_organization', { p_business_name: name, p_website: website ?? '', p_service_area: '', p_primary_goal: '' });
    if (error) { if (error.code === '42501') throw new ForbiddenError('Sign in to create a business'); if (error.code === 'P0001') throw new ConflictError(error.message, 'org_limit'); throw new ValidationError(error.message); }
    return data as string;
  }
  async get(_b: string, id: string) {
    const { data: o } = await this.c.from('organizations').select('id,name,created_by,created_at,updated_at').eq('id', id).maybeSingle();
    if (!o) return undefined;
    const { data: p } = await this.c.from('business_profiles').select('website').eq('organization_id', id).maybeSingle();
    return this.row(o as never, (p as { website?: string } | null)?.website);
  }
  async list(businessId: string) { const r = await this.get(businessId, businessId); return r ? [r] : []; }
  async listAcross(_w: Where) { const { data } = await this.c.from('organizations').select('id,name,created_by,created_at,updated_at'); return (data ?? []).map((o: unknown) => this.row(o as never)); }
  async update(businessId: string, id: string, patch: Partial<Omit<BusinessRow, 'id' | 'businessId' | 'version' | 'createdAt' | 'updatedAt'>>) {
    if (patch.name) { const { error } = await this.c.from('organizations').update({ name: patch.name }).eq('id', id); if (error) throw new ForbiddenError('Only an owner can rename the business'); }
    if (patch.website !== undefined) { const { error } = await this.c.from('business_profiles').update({ website: patch.website }).eq('organization_id', id); if (error) throw new ForbiddenError('You cannot change the website'); }
    return this.require(businessId, id);
  }
}

export class MemberTable extends Unsupported<MemberRow> implements Table<MemberRow> {
  constructor(private readonly c: SupabaseLike) { super(); }
  private row(m: { organization_id: string; user_id: string; role: string; created_at: string }): MemberRow {
    return { id: `${m.organization_id}:${m.user_id}`, businessId: m.organization_id, userId: m.user_id, role: m.role === 'owner' ? 'owner' : 'member', version: 1, createdAt: m.created_at, updatedAt: m.created_at };
  }
  async get(businessId: string, id: string): Promise<MemberRow | undefined> { return (await this.list(businessId)).find((m: MemberRow) => m.id === id); }
  async list(businessId: string, where?: Where) {
    let q = this.c.from('organization_members').select('organization_id,user_id,role,created_at').eq('organization_id', businessId);
    if (where?.userId) q = q.eq('user_id', where.userId as string);
    const { data, error } = await q; if (error) throw new ForbiddenError('Not allowed'); return (data ?? []).map((m: unknown) => this.row(m as never));
  }
  async listAcross(where: Where) {
    let q = this.c.from('organization_members').select('organization_id,user_id,role,created_at').order('created_at');
    if (where.userId) q = q.eq('user_id', where.userId as string);
    const { data, error } = await q; if (error) throw new ForbiddenError('Not allowed'); return (data ?? []).map((m: unknown) => this.row(m as never));
  }
  async update(): Promise<MemberRow> { return this.deny('Membership'); }
}

/** Read-only view of what the customer has paid for, derived from `subscriptions` and `purchases` (written only by the Stripe webhook). */
export class BillingView extends Unsupported<BillingRow> implements Table<BillingRow> {
  constructor(private readonly c: SupabaseLike) { super(); }
  async get(businessId: string) { return (await this.list(businessId, {}))[0]; }
  async list(businessId: string, where?: Where) {
    const [{ data: subs }, { data: buys }] = await Promise.all([
      this.c.from('subscriptions').select('id,plan_id,status,current_period_end,cancel_at_period_end,billing_interval,created_at,updated_at').eq('organization_id', businessId),
      this.c.from('purchases').select('plan_id,paid_at').eq('organization_id', businessId),
    ]);
    type S = { id: string; plan_id: string; status: string; current_period_end: string | null; cancel_at_period_end: boolean; billing_interval: string | null; created_at: string; updated_at: string };
    const live = ((subs ?? []) as S[]).filter((s) => ['active', 'trialing'].includes(s.status) && canonicalPlan(s.plan_id) && canonicalPlan(s.plan_id) !== 'report')
      .sort((a, b) => ['suite', 'studio', 'assistant'].indexOf(canonicalPlan(a.plan_id)!) - ['suite', 'studio', 'assistant'].indexOf(canonicalPlan(b.plan_id)!))[0];
    const credits = ((buys ?? []) as { plan_id: string }[]).filter((p) => canonicalPlan(p.plan_id) === 'report').length;
    if (!live && !credits) return [];
    const end = live?.current_period_end ?? undefined; const interval = live?.billing_interval === 'year' ? 'year' : 'month';
    const start = end ? new Date(new Date(end).getTime() - (interval === 'year' ? 365 : 30) * 86400000).toISOString() : (live?.created_at ?? new Date().toISOString());
    const row: BillingRow = { id: businessId, businessId, userId: (where?.userId as string) ?? '', reportCredits: credits, version: 1, createdAt: live?.created_at ?? new Date().toISOString(), updatedAt: live?.updated_at ?? new Date().toISOString(),
      ...(live ? { subscription: { id: live.id, plan: canonicalPlan(live.plan_id) as 'assistant' | 'studio' | 'suite', interval, status: live.status, currentPeriodStart: start, currentPeriodEnd: end ?? new Date().toISOString(), cancelAtPeriodEnd: live.cancel_at_period_end } } : {}) };
    return [row];
  }
  async listAcross() { return []; }
  async update(): Promise<BillingRow> { return this.deny('Billing'); }
}

/** Stripe events and anonymous previews are server-only and need a protected credential; a customer session can never use them. */
export class ServerOnlyTable<T extends { id: string; businessId: string; version: number; createdAt: string; updatedAt: string }> extends Unsupported<T> implements Table<T> {
  constructor(private readonly what: string) { super(); }
  async get() { return undefined; }
  async list(): Promise<T[]> { return []; }
  async listAcross(): Promise<T[]> { return []; }
  override async insert(_r: NewRow<T>): Promise<T> { return this.deny(this.what); }
  async update(): Promise<T> { return this.deny(this.what); }
}
