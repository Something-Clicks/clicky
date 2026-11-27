import { NotFoundError, ValidationError } from '../core/errors';
import { daysBetween, nowIso, normalizeText } from '../core/util';
import type { ProvenanceSource, Provenance } from '../domain/enums';
import type { ProfileFieldValue, ProfileRow } from '../domain/models';
import type { Ctx } from '../store/authz';
import { Authz, siteOf } from '../store/authz';
import type { AuditLog } from '../store/audit';
import type { Db } from '../store/db';
import { FIELD_BY_KEY, PROFILE_FIELDS } from './fields';

const TRUST: Record<ProvenanceSource, number> = {
  customer_confirmed: 5, customer_supplied: 4, manual_import: 3, research: 2, website: 2, ai_inference: 1, system: 0,
};
/** Days after which information of this provenance is no longer treated as current fact (spec §3.4). */
const TTL_DAYS: Record<ProvenanceSource, number> = {
  customer_confirmed: 365, customer_supplied: 270, manual_import: 120, research: 120, website: 90, ai_inference: 45, system: 3650,
};
export type Freshness = 'fresh' | 'aging' | 'stale';
export const freshness = (f: { provenance: Provenance }, at = nowIso()): Freshness => {
  const age = daysBetween(f.provenance.recordedAt, at); const ttl = TTL_DAYS[f.provenance.source];
  return age > ttl ? 'stale' : age > ttl * 0.7 ? 'aging' : 'fresh';
};
export const isAssumption = (f: ProfileFieldValue): boolean => !f.confirmed && (f.provenance.source === 'ai_inference' || f.provenance.evidence === 'inferred' || f.provenance.evidence === 'estimated');

const same = (a: string | string[], b: string | string[]): boolean =>
  normalizeText([a].flat().sort().join('|')) === normalizeText([b].flat().sort().join('|'));
const isEmpty = (v: string | string[]): boolean => (Array.isArray(v) ? v.every((x) => !x.trim()) : !v.trim());

export interface FieldUpdate { key: string; value: string | string[]; provenance: Omit<Provenance, 'recordedAt'> & { recordedAt?: string } }
export interface UpdateOutcome { applied: string[]; conflicts: string[]; ignored: string[] }

export class ProfileService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog) {}

  async get(ctx: Ctx): Promise<ProfileRow> {
    await this.authz.require(ctx, 'view');
    return this.effective(ctx);
  }
  /** The shared (business-level) profile. For the primary site this IS the site's profile. */
  async getInternal(businessId: string): Promise<ProfileRow> {
    const p = await this.db.profiles.get(businessId, businessId);
    if (!p) throw new NotFoundError('profile');
    return p;
  }
  /** What the agent should use for the active site: shared brand/customer facts, overridden by anything recorded for this site. */
  async effective(ctx: Ctx): Promise<ProfileRow> {
    const base = await this.getInternal(ctx.businessId);
    if (siteOf(ctx) === ctx.businessId) return base;
    const site = await this.db.profiles.get(ctx.businessId, siteOf(ctx));
    return { ...base, fields: { ...base.fields, ...(site?.fields ?? {}) } };
  }
  /** The row that edits for this context are written to (site row for non-primary sites; created on first write). */
  private async writable(ctx: Ctx): Promise<ProfileRow> {
    if (siteOf(ctx) === ctx.businessId) return this.getInternal(ctx.businessId);
    return (await this.db.profiles.get(ctx.businessId, siteOf(ctx))) ?? this.db.profiles.insert({ id: siteOf(ctx), businessId: ctx.businessId, fields: {} });
  }

  /**
   * Update-not-restart merge. Rules:
   *  - customer_confirmed always wins and clears conflicts.
   *  - confirmed values are never overwritten by lower-trust sources; the proposal is stored as a conflict to ask about.
   *  - unconfirmed values are replaced only by equal-or-higher-trust sources (previous value is kept in `previous`).
   */
  async applyUpdates(ctx: Ctx, updates: FieldUpdate[], actor: { type: 'user' | 'agent' | 'system'; id: string }): Promise<UpdateOutcome> {
    await this.authz.require(ctx, actor.type === 'user' ? 'edit_profile' : 'run_agent');
    const out: UpdateOutcome = { applied: [], conflicts: [], ignored: [] };
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await this.writable(ctx);
      const fields = structuredClone(row.fields);
      out.applied = []; out.conflicts = []; out.ignored = [];
      for (const u of updates) {
        const def = FIELD_BY_KEY.get(u.key);
        if (!def) throw new ValidationError(`Unknown profile field "${u.key}"`);
        if (def.kind === 'list' && !Array.isArray(u.value)) throw new ValidationError(`"${u.key}" must be a list`);
        if (def.kind === 'text' && Array.isArray(u.value)) throw new ValidationError(`"${u.key}" must be text`);
        if (isEmpty(u.value)) { out.ignored.push(u.key); continue; }
        const prov: Provenance = { ...u.provenance, recordedAt: u.provenance.recordedAt ?? nowIso() };
        const cur = fields[u.key];
        const incomingConfirmed = prov.source === 'customer_confirmed';
        if (!cur) { fields[u.key] = { value: u.value, provenance: prov, confirmed: incomingConfirmed, updatedAt: nowIso(), conflicts: [], previous: [] }; out.applied.push(u.key); continue; }
        if (incomingConfirmed) {
          if (!same(cur.value, u.value)) cur.previous = [{ value: cur.value, provenance: cur.provenance }, ...cur.previous].slice(0, 5);
          Object.assign(cur, { value: u.value, provenance: prov, confirmed: true, updatedAt: nowIso(), conflicts: [] }); out.applied.push(u.key); continue;
        }
        if (same(cur.value, u.value)) {
          if (!cur.confirmed && TRUST[prov.source] >= TRUST[cur.provenance.source]) { cur.provenance = prov; cur.updatedAt = nowIso(); out.applied.push(u.key); } else out.ignored.push(u.key);
          continue;
        }
        const stale = freshness(cur) === 'stale';
        if (!cur.confirmed && (TRUST[prov.source] >= TRUST[cur.provenance.source] || stale)) {
          cur.previous = [{ value: cur.value, provenance: cur.provenance }, ...cur.previous].slice(0, 5);
          Object.assign(cur, { value: u.value, provenance: prov, updatedAt: nowIso() }); out.applied.push(u.key);
        } else {
          if (!cur.conflicts.some((c) => same(c.value, u.value))) cur.conflicts = [{ value: u.value, provenance: prov }, ...cur.conflicts].slice(0, 5);
          out.conflicts.push(u.key);
        }
      }
      try {
        await this.db.profiles.update(ctx.businessId, row.id, { fields }, row.version);
        await this.audit.record({ businessId: ctx.businessId, actorType: actor.type, actorId: actor.id, action: 'profile.update', entityType: 'profile', entityId: ctx.businessId, detail: { ...out } });
        return out;
      } catch (e) { if ((e as { code?: string }).code !== 'version_conflict') throw e; }
    }
    throw new ValidationError('Profile was modified concurrently; retry', 'version_conflict');
  }

  /** Customer confirms the current value of a field (or resolves a conflict by picking a value). */
  async confirm(ctx: Ctx, key: string, value?: string | string[]): Promise<void> {
    await this.authz.require(ctx, 'edit_profile');
    const row = await this.effective(ctx);
    const cur = row.fields[key];
    const v = value ?? cur?.value;
    if (v === undefined) throw new NotFoundError(`field ${key}`);
    await this.applyUpdates(ctx, [{ key, value: v, provenance: { source: 'customer_confirmed', evidence: 'verified' } }], { type: 'user', id: ctx.userId });
  }

  async completeness(businessId: string, siteId?: string): Promise<{ missingCore: string[]; unconfirmedCore: string[]; stale: string[]; conflicts: string[] }> {
    const p = await this.effective({ userId: '', businessId, siteId });
    const core = PROFILE_FIELDS.filter((f) => f.core);
    return {
      missingCore: core.filter((f) => !p.fields[f.key]).map((f) => f.key),
      unconfirmedCore: core.filter((f) => p.fields[f.key] && !p.fields[f.key]!.confirmed).map((f) => f.key),
      stale: Object.entries(p.fields).filter(([, f]) => freshness(f) === 'stale').map(([k]) => k),
      conflicts: Object.entries(p.fields).filter(([, f]) => f.conflicts.length).map(([k]) => k),
    };
  }

  /** Prompt-ready view: every fact carries its provenance, status and freshness so assumptions are never presented as fact. */
  static summarize(p: ProfileRow, cats: ('business' | 'brand' | 'customer' | 'context')[] = ['business', 'brand', 'customer', 'context']) {
    const out: Record<string, { value: string | string[]; status: 'confirmed' | 'supplied' | 'from_website' | 'assumption' | 'research'; freshness: Freshness; source: string; conflicting?: (string | string[])[] }> = {};
    for (const d of PROFILE_FIELDS.filter((f) => cats.includes(f.category))) {
      const f = p.fields[d.key]; if (!f) continue;
      out[d.key] = {
        value: f.value, freshness: freshness(f), source: f.provenance.sourceRef ?? f.provenance.source,
        status: f.confirmed ? 'confirmed' : isAssumption(f) ? 'assumption' : f.provenance.source === 'website' ? 'from_website' : f.provenance.source === 'research' ? 'research' : 'supplied',
        ...(f.conflicts.length ? { conflicting: f.conflicts.map((c) => c.value) } : {}),
      };
    }
    return out;
  }
  static text(p: ProfileRow, key: string): string | undefined { const v = p.fields[key]?.value; return v === undefined ? undefined : [v].flat().join('; '); }
  static list(p: ProfileRow, key: string): string[] { const v = p.fields[key]?.value; return v === undefined ? [] : [v].flat(); }
}
