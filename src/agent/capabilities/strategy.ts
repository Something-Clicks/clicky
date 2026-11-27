import { ForbiddenError, mockForbidden, ValidationError } from '../core/errors';
import { normalizeText } from '../core/util';
import type { StrategyRow } from '../domain/models';
import type { StructuredClient } from '../providers/structured';
import type { Usage } from '../providers/usage';
import type { ContextBuilder } from '../profile/context';
import { ProfileService } from '../profile/service';
import { detectUnsupportedClaims } from '../security/claims';
import type { Ctx } from '../store/authz';
import { Authz, inSite, siteOf } from '../store/authz';
import { OPEN_GATE, type PlanGate } from '../plans';
import type { AuditLog } from '../store/audit';
import type { Db } from '../store/db';
import { StrategySchema } from './contracts';
import { factsCorpus } from './content';

export class StrategyService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog, private readonly llm: StructuredClient, private readonly context: ContextBuilder, private readonly gate: PlanGate = OPEN_GATE) {}

  async generate(ctx: Ctx, usage: { current: Usage }, opts: { executionId?: string; focus?: string } = {}): Promise<StrategyRow> {
    await this.authz.require(ctx, 'run_agent'); await this.gate.require(ctx, 'strategy');
    const c = await this.context.build(ctx, ['business', 'brand', 'customer', 'research', 'cards', 'performance', 'history', 'strategy']);
    const cards = (c.cards as { id: string; title: string; category: string; recommendation: string; priority: { rank: number; label: string }; status: string; evidenceClass: string; confidence: string; estimatedEffort: string }[]).filter((x) => !['rejected', 'dismissed'].includes(x.status));
    const cardIds = new Set(cards.map((x) => x.id));
    const profile = c.profileRow;
    const anchors = [ProfileService.text(profile, 'name'), ...ProfileService.list(profile, 'products_services'), ...ProfileService.list(profile, 'service_areas')].filter((x): x is string => !!x).map(normalizeText);
    const corpus = factsCorpus(profile, c.researchLibrary.map((r) => JSON.stringify(r.data)));
    const res = await this.llm.generate({
      task: 'marketing_strategy', usage, schema: StrategySchema,
      instructions: `Develop a marketing strategy specific to THIS business: its actual products/services, customers, service areas, competitive position, website findings, channels it can realistically run, and any budget/resource constraints. Do not produce a generic plan. Reference existing action cards by id in prioritizedActions (only ids supplied). Prefer high-value low-effort work over sophisticated work. Separate facts from assumptions: put assumptions in "assumptions". Never invent metrics, targets with numbers, rankings or expected improvements. ${opts.focus ? `Focus: ${opts.focus}` : ''}`,
      input: { profile: c.profile, warnings: c.warnings, research: c.researchLibrary, cards, performance: (c.performance as unknown[]).length ? 'available' : 'none supplied', previousStrategy: c.strategy ? 'exists' : 'none' },
      validate: (s) => {
        const bad = s.prioritizedActions.find((a) => !cardIds.has(a.cardId));
        if (bad) return `prioritizedActions references unknown cardId "${bad.cardId}". Valid ids: ${[...cardIds].join(', ') || '(none)'}`;
        const all = normalizeText(JSON.stringify(s));
        if (anchors.length && !anchors.some((a) => all.includes(a))) return 'Strategy is generic: it must refer to the business by name and to its actual services or service areas.';
        const flags = detectUnsupportedClaims(JSON.stringify(s), corpus).filter((f) => f.severity === 'high');
        return flags.length ? `Remove unsupported claims: ${flags.slice(0, 5).map((f) => `"${f.excerpt}"`).join(', ')}` : null;
      },
    });
    for (const old of (await this.db.strategies.list(ctx.businessId, { status: 'draft' })).filter((x) => inSite(x, ctx))) await this.db.strategies.update(ctx.businessId, old.id, { status: 'superseded' });
    const row = await this.db.strategies.insert({ businessId: ctx.businessId, siteId: siteOf(ctx), mock: res.mock, data: res.data, basedOn: { cardIds: [...cardIds], researchIds: c.researchLibrary.map((r) => r.id), profileVersion: profile.version }, status: 'draft' });
    await this.audit.record({ businessId: ctx.businessId, actorType: 'agent', actorId: 'agent', action: 'strategy.created', entityType: 'strategy', entityId: row.id, detail: { executionId: opts.executionId, model: res.model, mock: res.mock } });
    return row;
  }
  async latest(ctx: Ctx): Promise<StrategyRow | undefined> { await this.authz.require(ctx, 'view'); return (await this.db.strategies.list(ctx.businessId, undefined, { newestFirst: true })).find((s) => inSite(s, ctx) && s.status !== 'superseded'); }
  async list(ctx: Ctx) { await this.authz.require(ctx, 'view'); return (await this.db.strategies.list(ctx.businessId, undefined, { newestFirst: true })).filter((s) => inSite(s, ctx)); }
  async approve(ctx: Ctx, id: string): Promise<StrategyRow> {
    await this.authz.require(ctx, 'approve_content');
    const s = await this.db.strategies.require(ctx.businessId, id);
    if (s.status === 'superseded') throw new ValidationError('Superseded strategies cannot be approved');
    if (s.mock && mockForbidden()) throw new ForbiddenError('This strategy was produced by a development stand-in and cannot be approved.', 'mock_content');
    const upd = await this.db.strategies.update(ctx.businessId, id, { status: 'approved' }, s.version);
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'strategy.approved', entityType: 'strategy', entityId: id });
    return upd;
  }
}
