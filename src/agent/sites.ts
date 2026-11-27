import { ConflictError, NotFoundError, ValidationError } from './core/errors';
import { newId } from './core/util';
import type { Location, SiteRow } from './domain/models';
import { OPEN_GATE, type PlanGate } from './plans';
import type { AuditLog } from './store/audit';
import type { Ctx } from './store/authz';
import { Authz } from './store/authz';
import type { Db } from './store/db';
import { parseSafeUrl } from './website/url-guard';

/** Websites and business locations (Marketing Suite). Every business has a primary site; only multi_site plans may add more. */
export class SiteService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog, private readonly gate: PlanGate = OPEN_GATE) {}

  /** Idempotent; also repairs businesses created before multi-site existed. */
  async ensurePrimary(businessId: string): Promise<SiteRow> {
    const ex = await this.db.sites.get(businessId, businessId); if (ex) return ex;
    const b = await this.db.businesses.require(businessId, businessId);
    const u = b.website ? parseSafeUrl(b.website) : undefined;
    return this.db.sites.insert({ id: businessId, businessId, name: b.name, url: u?.origin ?? '', domain: u?.hostname.replace(/^www\./, '') ?? '', isPrimary: true, locations: [] });
  }
  async list(ctx: Ctx): Promise<SiteRow[]> {
    await this.authz.require(ctx, 'view'); await this.ensurePrimary(ctx.businessId);
    return (await this.db.sites.list(ctx.businessId)).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  }
  async get(ctx: Ctx, id: string): Promise<SiteRow> { await this.authz.require(ctx, 'view'); await this.ensurePrimary(ctx.businessId); return this.db.sites.require(ctx.businessId, id); }

  /** Sites the customer may currently WORK in: only the primary site unless the plan includes multiple websites (extra sites stay readable after a downgrade). */
  async usable(ctx: Ctx): Promise<SiteRow[]> { const all = await this.list(ctx); return (await this.gate.has(ctx, 'multi_site')) ? all : all.filter((s) => s.isPrimary); }

  async add(ctx: Ctx, input: { name: string; url: string }): Promise<SiteRow> {
    await this.authz.require(ctx, 'edit_profile'); await this.gate.require(ctx, 'multi_site');
    const all = await this.list(ctx); const { maxSites } = await this.gate.limits(ctx);
    const name = input.name.trim(); if (!name) throw new ValidationError('Give the site a name');
    const u = parseSafeUrl(input.url); const domain = u.hostname.replace(/^www\./, '');
    if (all.some((s) => s.domain === domain)) throw new ConflictError('That website is already in your account', 'duplicate_site');
    if (all.length >= maxSites) throw new ConflictError(`Your plan includes up to ${maxSites} websites.`, 'site_limit');
    const s = await this.db.sites.insert({ businessId: ctx.businessId, name, url: u.origin, domain, isPrimary: false, locations: [] });
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'site.added', entityType: 'site', entityId: s.id, detail: { domain } });
    return s;
  }
  async remove(ctx: Ctx, id: string): Promise<void> {
    await this.authz.require(ctx, 'manage_members'); const s = await this.get(ctx, id);
    if (s.isPrimary) throw new ConflictError('The primary website cannot be removed', 'primary_site');
    await this.db.sites.update(ctx.businessId, id, { name: `${s.name} (removed)`, url: '', domain: `removed-${id}`, locations: [] });
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'site.removed', entityType: 'site', entityId: id });
  }
  async locationCount(ctx: Ctx): Promise<number> { return (await this.list(ctx)).reduce((n, s) => n + s.locations.length, 0); }

  /** A business may always record one location; more than one needs the locations feature and stays within the plan's limit. */
  async addLocation(ctx: Ctx, siteId: string, loc: Omit<Location, 'id' | 'serviceAreas'> & { serviceAreas?: string[] }): Promise<SiteRow> {
    await this.authz.require(ctx, 'edit_profile'); const site = await this.get(ctx, siteId);
    if (!loc.name.trim()) throw new ValidationError('Give the location a name');
    if (loc.zip && !/^\d{5}$/.test(loc.zip)) throw new ValidationError('Enter a 5-digit ZIP code');
    const count = await this.locationCount(ctx);
    if (count >= 1) { await this.gate.require(ctx, 'locations'); const { maxLocations } = await this.gate.limits(ctx); if (count >= maxLocations) throw new ConflictError(`Your plan includes up to ${maxLocations} locations.`, 'location_limit'); }
    const l: Location = { ...loc, name: loc.name.trim(), id: newId(), serviceAreas: loc.serviceAreas ?? [] };
    const upd = await this.db.sites.update(ctx.businessId, siteId, { locations: [...site.locations, l] }, site.version);
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'location.added', entityType: 'site', entityId: siteId, detail: { name: l.name } });
    return upd;
  }
  async removeLocation(ctx: Ctx, siteId: string, locationId: string): Promise<SiteRow> {
    await this.authz.require(ctx, 'edit_profile'); const site = await this.get(ctx, siteId);
    if (!site.locations.some((l) => l.id === locationId)) throw new NotFoundError('location');
    return this.db.sites.update(ctx.businessId, siteId, { locations: site.locations.filter((l) => l.id !== locationId) }, site.version);
  }
}
