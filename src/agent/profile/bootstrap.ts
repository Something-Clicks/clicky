import { ValidationError } from '../core/errors';
import { newId, nowIso } from '../core/util';
import type { Ctx } from '../store/authz';
import type { AuditLog } from '../store/audit';
import type { Db } from '../store/db';
import { parseSafeUrl } from '../website/url-guard';

/** Creates a business (its own tenant: id === businessId), the owner membership and an empty persistent profile. */
export async function createBusiness(
  db: Db, audit: AuditLog, ownerId: string, input: { name: string; website?: string },
): Promise<Ctx> {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Business name is required');
  let website: string | undefined; let domain: string | undefined;
  if (input.website) { const u = parseSafeUrl(input.website); website = u.origin; domain = u.hostname.replace(/^www\./, ''); }
  const id = db.provision ? await db.provision(name, website) : newId();
  if (!db.provision) {
    await db.businesses.insert({ id, businessId: id, name, ownerId, website });
    await db.members.insert({ businessId: id, userId: ownerId, role: 'owner' });
  }
  const prov = { source: 'customer_confirmed' as const, evidence: 'verified' as const, recordedAt: nowIso() };
  const mk = (value: string) => ({ value, provenance: prov, confirmed: true, updatedAt: prov.recordedAt, conflicts: [], previous: [] });
  await db.profiles.insert({
    id, businessId: id,
    fields: { name: mk(name), ...(website ? { website: mk(website), domain: mk(domain!) } : {}) },
  });
  await db.sites.insert({ id, businessId: id, name, url: website ?? '', domain: domain ?? '', isPrimary: true, locations: [] });
  await audit.record({ businessId: id, actorType: 'user', actorId: ownerId, action: 'business.create', entityType: 'business', entityId: id });
  return { userId: ownerId, businessId: id };
}
