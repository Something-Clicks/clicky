import { ForbiddenError } from '../core/errors';
import type { Role } from '../domain/enums';
import type { Db } from './db';

export type Permission =
  | 'view' | 'run_agent' | 'edit_profile' | 'edit_content' | 'approve_content'
  | 'decide_cards' | 'authorize_execution' | 'ingest_data' | 'manage_members';

const MATRIX: Record<Role, Permission[]> = {
  owner: ['view', 'run_agent', 'edit_profile', 'edit_content', 'approve_content', 'decide_cards', 'authorize_execution', 'ingest_data', 'manage_members'],
  admin: ['view', 'run_agent', 'edit_profile', 'edit_content', 'approve_content', 'decide_cards', 'authorize_execution', 'ingest_data'],
  editor: ['view', 'run_agent', 'edit_profile', 'edit_content', 'approve_content', 'decide_cards', 'ingest_data'],
  viewer: ['view'],
};

/** `siteId` is the active website (defaults to the primary site, whose id equals the businessId). */
/** `runId` is set while a workflow executes, so that run's own in-flight reservation is not counted against it. */
export interface Ctx { userId: string; businessId: string; siteId?: string; runId?: string }
export const siteOf = (c: { businessId: string; siteId?: string }): string => c.siteId ?? c.businessId;
/** Rows saved before multi-site existed belong to the primary site. */
export const inSite = (r: { businessId: string; siteId?: string }, c: Ctx): boolean => (r.siteId ?? r.businessId) === siteOf(c);

/** Server-side role enforcement. Nothing the model outputs can grant a permission. */
export class Authz {
  constructor(private readonly db: Db) {}

  async role(userId: string, businessId: string): Promise<Role | undefined> {
    const m = (await this.db.members.list(businessId, { userId }))[0];
    return m?.role;
  }
  async can(userId: string, businessId: string, p: Permission): Promise<boolean> {
    const r = await this.role(userId, businessId);
    return !!r && MATRIX[r].includes(p);
  }
  async require(ctx: Ctx, p: Permission): Promise<Role> {
    const r = await this.role(ctx.userId, ctx.businessId);
    // Same error whether the business doesn't exist or the user isn't a member: no tenant enumeration.
    if (!r || !MATRIX[r].includes(p)) throw new ForbiddenError(`Missing permission: ${p}`);
    return r;
  }
}
