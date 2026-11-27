import type { Ctx } from '../store/authz';
import { Authz, inSite } from '../store/authz';
import type { Db } from '../store/db';
import { freshness, ProfileService } from './service';

export type ContextNeed = 'business' | 'brand' | 'customer' | 'research' | 'strategy' | 'history' | 'performance' | 'cards';

/** Controlled memory retrieval (spec §14): only the slices a task needs, only if the user may view them. */
export class ContextBuilder {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly profiles: ProfileService) {}

  async build(ctx: Ctx, needs: ContextNeed[]) {
    await this.authz.require(ctx, 'view');
    const profile = await this.profiles.effective(ctx);
    const cats = (['business', 'brand', 'customer'] as const).filter((c) => needs.includes(c));
    const out: {
      profile: ReturnType<typeof ProfileService.summarize>;
      profileRow: typeof profile;
      researchLibrary: { id: string; kind: string; title: string; evidence: string; collectedAt: string; freshness: string; data: unknown }[];
      strategy?: unknown; history: unknown[]; performance: unknown[]; cards: unknown[];
      warnings: string[];
    } = { profile: ProfileService.summarize(profile, [...cats, 'context']), profileRow: profile, researchLibrary: [], history: [], performance: [], cards: [], warnings: [] };

    const comp = await this.profiles.completeness(ctx.businessId, ctx.siteId);
    if (comp.conflicts.length) out.warnings.push(`Conflicting information needs customer clarification: ${comp.conflicts.join(', ')}`);
    if (comp.stale.length) out.warnings.push(`Outdated information (do not treat as current): ${comp.stale.join(', ')}`);

    if (needs.includes('research')) {
      for (const r of (await this.db.research.list(ctx.businessId, undefined, { newestFirst: true, limit: 80 })).filter((x) => inSite(x, ctx)).slice(0, 40)) {
        const f = freshness({ provenance: { source: 'research', recordedAt: r.collectedAt, evidence: r.evidence } });
        out.researchLibrary.push({ id: r.id, kind: r.kind, title: r.title, evidence: r.evidence, collectedAt: r.collectedAt, freshness: f, data: f === 'stale' ? '[stale: refresh before relying on this]' : r.data });
      }
    }
    if (needs.includes('strategy')) out.strategy = (await this.db.strategies.list(ctx.businessId, undefined, { newestFirst: true })).filter((x) => inSite(x, ctx) && x.status !== 'superseded')[0];
    if (needs.includes('history')) out.history = (await this.db.audit.list(ctx.businessId, undefined, { newestFirst: true, limit: 30 })).filter((a) => /^(card|deliverable|execution|campaign)\./.test(a.action)).map((a) => ({ at: a.createdAt, action: a.action, entity: a.entityId, detail: a.detail }));
    if (needs.includes('performance')) out.performance = (await this.db.metrics.list(ctx.businessId, undefined, { newestFirst: true })).filter((x) => inSite(x, ctx)).slice(0, 200);
    if (needs.includes('cards')) out.cards = (await this.db.cards.list(ctx.businessId, undefined, { newestFirst: true })).filter((x) => inSite(x, ctx)).slice(0, 50).map((c) => ({ id: c.id, ...c.card }));
    return out;
  }
}
