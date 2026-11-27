import { ConflictError, ForbiddenError, ValidationError } from '../core/errors';
import { hashContent, normalizeText, nowIso } from '../core/util';
import type { ActionCard, CardRow, CardStatus, Finding } from '../domain/models';
import type { Ctx } from '../store/authz';
import { Authz, inSite, siteOf } from '../store/authz';
import type { AuditLog } from '../store/audit';
import type { Db } from '../store/db';
import { priorityLabel, scoreFinding } from './analysis';

export const dedupeKeyOf = (f: Pick<Finding, 'category' | 'title'>): string => hashContent(`${f.category}|${normalizeText(f.title)}`).slice(0, 16);

const TRANSITIONS: Record<CardStatus, CardStatus[]> = {
  new: ['drafting', 'ready_for_review', 'approved', 'rejected', 'dismissed', 'resolved'],
  drafting: ['ready_for_review', 'new', 'failed', 'resolved'],
  ready_for_review: ['approved', 'rejected', 'drafting', 'dismissed', 'resolved'],
  approved: ['authorized', 'executing', 'executed', 'verified', 'ready_for_review', 'rejected', 'resolved'],
  rejected: ['new', 'drafting'],
  dismissed: ['new'],
  authorized: ['executing', 'approved', 'failed'],
  executing: ['executed', 'failed', 'verified'],
  executed: ['verified', 'failed', 'resolved'],
  verified: ['resolved'],
  failed: ['authorized', 'approved', 'drafting', 'new'],
  resolved: ['new'], // a fixed issue that reappears is reopened
};

/** What can actually be done with an approved deliverable in this release. Honest about missing integrations. */
export const EXECUTION_CAPABILITY = {
  available: true as const,
  method: 'download_export' as const,
  reason: 'Approved drafts can be saved to your workspace, exported, or recorded as completed. Direct publishing to your website, email platform or social accounts is not connected yet.',
};

export function buildCard(f: Finding, rank: number, objectives: string[], idByFindingKey: Map<string, string> = new Map()): ActionCard {
  const s = scoreFinding(f, objectives);
  return {
    title: f.title, category: f.category, finding: f.observed, evidence: f.evidence, importance: f.whyItMatters, recommendation: f.recommendation,
    priority: { rank, score: s.score, label: priorityLabel(s.score) }, confidence: f.confidence, evidenceClass: f.evidenceClass, estimatedEffort: f.effort,
    dependencies: f.dependsOn.map((k) => idByFindingKey.get(k)).filter((x): x is string => !!x), deliverableType: f.deliverableType,
    status: 'new', approval: { required: !!f.deliverableType },
    execution: f.deliverableType ? { ...EXECUTION_CAPABILITY } : { available: false, method: 'none', reason: 'This is a recommendation; there is no prepared deliverable to execute.' },
    findingKey: f.key, dedupeKey: dedupeKeyOf(f), origin: f.origin,
  };
}

export class CardService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog) {}

  /** Save scored findings as cards, skipping any already open with the same dedupe key (no duplicate cards on re-run). */
  async createFromFindings(ctx: Ctx, findings: Finding[], opts: { executionId?: string; objectives?: string[]; actor: { type: 'agent' | 'user' | 'system'; id: string } }): Promise<CardRow[]> {
    await this.authz.require(ctx, 'run_agent');
    const existing = (await this.db.cards.list(ctx.businessId)).filter((c) => inSite(c, ctx));
    const open = new Map(existing.map((c) => [c.card.dedupeKey, c]));
    const scored = findings.map((f) => ({ f, s: scoreFinding(f, opts.objectives) })).sort((a, b) => b.s.score - a.s.score);
    const created: CardRow[] = []; const idByKey = new Map<string, string>();
    let rank = 1;
    for (const { f } of scored) {
      const dk = dedupeKeyOf(f);
      const dup = open.get(dk);
      if (dup) { idByKey.set(f.key, dup.id); if (dup.card.status === 'resolved') await this.setStatus(ctx.businessId, dup.id, 'new', opts.actor, 'The issue was detected again on a later review'); continue; }
      const row = await this.db.cards.insert({ businessId: ctx.businessId, siteId: siteOf(ctx), executionId: opts.executionId, card: buildCard(f, rank++, opts.objectives ?? [], idByKey), decisions: [] });
      idByKey.set(f.key, row.id); created.push(row);
      await this.db.findings.insert({ businessId: ctx.businessId, siteId: siteOf(ctx), executionId: opts.executionId, finding: f, priorityScore: row.card.priority.score });
    }
    if (created.length) await this.audit.record({ businessId: ctx.businessId, actorType: opts.actor.type, actorId: opts.actor.id, action: 'card.created', entityType: 'card', entityId: created[0]!.id, detail: { count: created.length, executionId: opts.executionId } });
    return created;
  }

  /** Cards already on the board for these findings (new or pre-existing), in finding order. */
  async matchExisting(ctx: Ctx, findings: Finding[]): Promise<CardRow[]> {
    await this.authz.require(ctx, 'view');
    const keys = new Map((await this.db.cards.list(ctx.businessId)).filter((c) => inSite(c, ctx)).map((c) => [c.card.dedupeKey, c]));
    return findings.map((f) => keys.get(dedupeKeyOf(f))).filter((c): c is CardRow => !!c);
  }

  async board(ctx: Ctx, filter: { status?: CardStatus[]; category?: string } = {}): Promise<CardRow[]> {
    await this.authz.require(ctx, 'view');
    return (await this.db.cards.list(ctx.businessId))
      .filter((c) => inSite(c, ctx) && (!filter.status || filter.status.includes(c.card.status)) && (!filter.category || c.card.category === filter.category))
      .sort((a, b) => a.card.priority.rank - b.card.priority.rank);
  }
  /** Cards across ALL of the business's sites (portfolio views). */
  async boardAllSites(ctx: Ctx): Promise<CardRow[]> { await this.authz.require(ctx, 'view'); return (await this.db.cards.list(ctx.businessId)).sort((a, b) => a.card.priority.rank - b.card.priority.rank); }

  /**
   * Progress tracking on a re-review: an open card whose (deterministic) finding is no longer detected on a FRESH scan is marked
   * resolved. Model-derived and performance cards are never auto-resolved because they are not reproducible checks.
   */
  async reconcile(ctx: Ctx, currentRuleFindings: Finding[], by: { type: 'agent' | 'system'; id: string }): Promise<CardRow[]> {
    await this.authz.require(ctx, 'run_agent');
    const still = new Set(currentRuleFindings.map((f) => dedupeKeyOf(f))); const done: CardRow[] = [];
    for (const c of (await this.db.cards.list(ctx.businessId)).filter((x) => inSite(x, ctx))) {
      if (c.card.origin !== 'rule' || still.has(c.card.dedupeKey)) continue;
      if (!['new', 'drafting', 'ready_for_review', 'approved', 'executed', 'verified'].includes(c.card.status)) continue;
      if (c.card.category === 'customer_acquisition' || c.card.findingKey?.startsWith('followup_') || c.card.findingKey?.startsWith('gap_') || c.card.findingKey?.startsWith('comp_')) continue;
      done.push(await this.setStatus(ctx.businessId, c.id, 'resolved', by, 'No longer detected on the latest website review'));
    }
    return done;
  }

  async get(ctx: Ctx, id: string): Promise<CardRow> { await this.authz.require(ctx, 'view'); return this.db.cards.require(ctx.businessId, id); }

  /** Internal status transition used by deliverable/execution services. Enforces the state machine. */
  async setStatus(businessId: string, id: string, to: CardStatus, by: { type: 'user' | 'agent' | 'system'; id: string }, note?: string): Promise<CardRow> {
    const row = await this.db.cards.require(businessId, id);
    if (row.card.status === to) return row;
    if (!TRANSITIONS[row.card.status].includes(to)) throw new ConflictError(`Cannot move card from ${row.card.status} to ${to}`, 'invalid_transition');
    const card = { ...row.card, status: to, approval: to === 'approved' ? { required: row.card.approval.required, approvedBy: by.id, approvedAt: nowIso() } : row.card.approval };
    const upd = await this.db.cards.update(businessId, id, { card, decisions: [...row.decisions, { at: nowIso(), by: by.id, action: to, note }] }, row.version);
    await this.audit.record({ businessId, actorType: by.type, actorId: by.id, action: `card.${to}`, entityType: 'card', entityId: id, detail: { from: row.card.status, note } });
    return upd;
  }

  /** Customer decision on a card that has no deliverable (or to dismiss/reopen). Approval of deliverable-backed cards goes through DeliverableService. */
  async decide(ctx: Ctx, id: string, action: 'accept' | 'reject' | 'dismiss' | 'reopen', note?: string): Promise<CardRow> {
    await this.authz.require(ctx, 'decide_cards');
    const row = await this.db.cards.require(ctx.businessId, id);
    if (action === 'accept' && row.card.deliverableId) throw new ValidationError('Approve the prepared deliverable instead', 'use_deliverable_approval');
    if (action === 'accept' && row.card.approval.required && !row.card.deliverableId) throw new ForbiddenError('This card needs a prepared deliverable before it can be approved', 'no_deliverable');
    const to: CardStatus = action === 'accept' ? 'approved' : action === 'reject' ? 'rejected' : action === 'dismiss' ? 'dismissed' : 'new';
    return this.setStatus(ctx.businessId, id, to, { type: 'user', id: ctx.userId }, note);
  }

  async attachDeliverable(businessId: string, cardId: string, deliverableId: string): Promise<void> {
    const row = await this.db.cards.require(businessId, cardId);
    await this.db.cards.update(businessId, cardId, { card: { ...row.card, deliverableId } }, row.version);
  }
}
