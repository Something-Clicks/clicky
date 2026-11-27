import { ConflictError, ValidationError } from '../core/errors';
import { nowIso, uniq } from '../core/util';
import type { DeliverableType } from '../domain/enums';
import type { CampaignRow, CampaignTask } from '../domain/models';
import type { StructuredClient } from '../providers/structured';
import type { Usage } from '../providers/usage';
import type { ContextBuilder } from '../profile/context';
import type { Ctx } from '../store/authz';
import { Authz, inSite, siteOf } from '../store/authz';
import { OPEN_GATE, type PlanGate } from '../plans';
import type { AuditLog } from '../store/audit';
import type { Db } from '../store/db';
import { CampaignPlanSchema, type CampaignPlanOutput } from './contracts';
import type { DeliverableService } from './content';
import { ProfileService } from '../profile/service';

const DEFAULT_TYPE: Record<CampaignTask['type'], DeliverableType | undefined> = {
  landing_page: 'landing_page', email: 'email_sequence', social: 'social_posts', content: 'blog_outline', research: undefined, distribution: undefined, measurement: undefined, review: undefined,
};
const TRAFFIC: CampaignTask['type'][] = ['email', 'social', 'distribution'];

export function topoOrder(tasks: { key: string; dependsOn: string[] }[]): string[] {
  const keys = new Set(tasks.map((t) => t.key)); const indeg = new Map(tasks.map((t) => [t.key, 0])); const out = new Map<string, string[]>();
  for (const t of tasks) for (const d of t.dependsOn) { if (!keys.has(d)) throw new ValidationError(`Task "${t.key}" depends on unknown task "${d}"`); indeg.set(t.key, indeg.get(t.key)! + 1); (out.get(d) ?? out.set(d, []).get(d)!).push(t.key); }
  const q = [...indeg.entries()].filter(([, n]) => n === 0).map(([k]) => k); const order: string[] = [];
  while (q.length) { const k = q.shift()!; order.push(k); for (const n of out.get(k) ?? []) { indeg.set(n, indeg.get(n)! - 1); if (indeg.get(n) === 0) q.push(n); } }
  if (order.length !== tasks.length) throw new ValidationError('Campaign tasks contain a dependency cycle');
  return order;
}

/**
 * Deterministic repair of a model plan: enforces the dependency rules the spec calls out.
 *  - Traffic-driving tasks (email, social, distribution) must depend on the landing page task.
 *  - Measurement depends on every deliverable-producing task; a landing page task is added if the plan sends traffic without one.
 */
export function normalizePlan(plan: CampaignPlanOutput): { tasks: CampaignTask[]; repairs: string[] } {
  const repairs: string[] = [];
  const tasks: CampaignTask[] = plan.tasks.map((t) => ({ ...t, deliverableType: t.deliverableType ?? DEFAULT_TYPE[t.type], dependsOn: uniq(t.dependsOn), status: 'blocked' as const }));
  if (new Set(tasks.map((t) => t.key)).size !== tasks.length) throw new ValidationError('Duplicate task keys in campaign plan');
  let lp = tasks.find((t) => t.type === 'landing_page');
  if (!lp && tasks.some((t) => TRAFFIC.includes(t.type))) {
    lp = { key: 'landing_page', title: 'Prepare campaign landing page', type: 'landing_page', deliverableType: 'landing_page', description: 'Landing page for the campaign offer (added because the plan sends traffic).', dependsOn: [], offsetDays: 0, status: 'blocked' };
    tasks.unshift(lp); repairs.push('Added a landing page task because the plan sends traffic.');
  }
  for (const t of tasks) if (lp && TRAFFIC.includes(t.type) && t.key !== lp.key && !t.dependsOn.includes(lp.key)) { t.dependsOn.push(lp.key); repairs.push(`"${t.title}" now depends on the landing page.`); t.offsetDays = Math.max(t.offsetDays, lp.offsetDays + 1); }
  const producers = tasks.filter((t) => t.deliverableType).map((t) => t.key);
  for (const t of tasks) if (t.type === 'measurement') for (const p of producers) if (!t.dependsOn.includes(p) && p !== t.key) t.dependsOn.push(p);
  topoOrder(tasks);
  return { tasks, repairs };
}

export function refreshStatuses(tasks: CampaignTask[]): CampaignTask[] {
  const done = new Set(tasks.filter((t) => t.status === 'done' || t.status === 'skipped').map((t) => t.key));
  return tasks.map((t) => (['done', 'skipped', 'in_progress', 'awaiting_approval'].includes(t.status) ? t : { ...t, status: t.dependsOn.every((d) => done.has(d)) ? 'ready' : 'blocked' }));
}

export class CampaignService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog, private readonly llm: StructuredClient, private readonly context: ContextBuilder, private readonly deliverables: DeliverableService, private readonly gate: PlanGate = OPEN_GATE) {}

  async plan(ctx: Ctx, input: { goal: string; offer?: string; startDate?: string }, usage: { current: Usage }): Promise<CampaignRow> {
    await this.authz.require(ctx, 'run_agent'); await this.gate.require(ctx, 'campaigns');
    const c = await this.context.build(ctx, ['business', 'brand', 'customer', 'research', 'strategy']);
    const services = ProfileService.list(c.profileRow, 'products_services');
    const res = await this.llm.generate({
      task: 'campaign_plan', usage, schema: CampaignPlanSchema,
      instructions: `Plan ONE coordinated campaign for the goal. Use only real services/offers from the profile or supplied offer: do not invent discounts, prices or guarantees. Tasks need dependencies: the landing page must exist before email/social/distribution tasks that send traffic; include a measurement task last. Task keys are lowercase snake_case. Include channels the business can realistically run.`,
      input: { goal: input.goal, offer: input.offer ?? null, profile: c.profile, strategy: c.strategy ? (c.strategy as { data: unknown }).data : null, research: c.researchLibrary.slice(0, 8) },
      validate: (p) => (services.length && !p.tasks.length ? 'No tasks' : null),
    });
    const { tasks, repairs } = normalizePlan(res.data);
    const row = await this.db.campaigns.insert({
      businessId: ctx.businessId, siteId: siteOf(ctx), name: res.data.name, objective: res.data.objective, audience: res.data.audience, offer: input.offer ?? res.data.offer, coreMessage: res.data.coreMessage,
      channels: res.data.channels, tasks: refreshStatuses(tasks), measurementPlan: res.data.measurementPlan, risks: [...res.data.risks, ...repairs.map((r) => `Plan adjusted: ${r}`)], startDate: input.startDate, status: 'planning',
    });
    await this.audit.record({ businessId: ctx.businessId, actorType: 'agent', actorId: 'agent', action: 'campaign.created', entityType: 'campaign', entityId: row.id, detail: { repairs, model: res.model, mock: res.mock } });
    return row;
  }

  async get(ctx: Ctx, id: string) { await this.authz.require(ctx, 'view'); return this.db.campaigns.require(ctx.businessId, id); }
  async list(ctx: Ctx) { await this.authz.require(ctx, 'view'); return (await this.db.campaigns.list(ctx.businessId, undefined, { newestFirst: true })).filter((c) => inSite(c, ctx)); }

  /** Prepare the deliverable for one task. Refuses to run while dependencies are incomplete. */
  async prepareTask(ctx: Ctx, id: string, key: string, usage: { current: Usage }) {
    await this.authz.require(ctx, 'run_agent'); await this.gate.require(ctx, 'campaigns');
    let c = await this.db.campaigns.require(ctx.businessId, id);
    c = await this.syncFromDeliverables(c);
    const t = c.tasks.find((x) => x.key === key); if (!t) throw new ValidationError(`Unknown task ${key}`);
    if (t.status === 'blocked') throw new ConflictError(`"${t.title}" is blocked until: ${t.dependsOn.filter((d) => c.tasks.find((x) => x.key === d)?.status !== 'done').join(', ')}`, 'dependency_not_complete');
    if (t.deliverableId) throw new ConflictError('A deliverable already exists for this task', 'already_prepared');
    if (!t.deliverableType) throw new ValidationError('This task has no deliverable to prepare; mark it done manually');
    const landing = c.tasks.find((x) => x.type === 'landing_page' && x.deliverableId);
    const d = await this.deliverables.generate(ctx, {
      type: t.deliverableType, campaignId: c.id, campaignTaskKey: t.key, brief: `Campaign "${c.name}" — objective: ${c.objective}. Audience: ${c.audience}. Offer: ${c.offer}. Core message: ${c.coreMessage}. Task: ${t.title} — ${t.description}${landing ? ` Link readers to the campaign landing page (deliverable ${landing.deliverableId}).` : ''}`,
      suppliedFacts: [c.offer, c.coreMessage, c.objective],
    }, usage);
    const fresh = await this.db.campaigns.require(ctx.businessId, id);
    const tasks = fresh.tasks.map((x) => (x.key === key ? { ...x, deliverableId: d.id, status: 'awaiting_approval' as const } : x));
    await this.db.campaigns.update(ctx.businessId, id, { tasks: refreshStatuses(tasks) }, fresh.version);
    return d;
  }

  /** A deliverable task is done when its deliverable is approved. */
  async syncFromDeliverables(c: CampaignRow): Promise<CampaignRow> {
    let changed = false; const tasks = [...c.tasks];
    for (const [i, t] of tasks.entries()) if (t.deliverableId && t.status === 'awaiting_approval') {
      const d = await this.db.deliverables.get(c.businessId, t.deliverableId);
      if (d?.status === 'approved') { tasks[i] = { ...t, status: 'done' }; changed = true; }
    }
    if (!changed) return c;
    return this.db.campaigns.update(c.businessId, c.id, { tasks: refreshStatuses(tasks), status: tasks.every((t) => ['done', 'skipped'].includes(t.status)) ? 'completed' : c.status }, c.version);
  }

  async markTask(ctx: Ctx, id: string, key: string, status: 'done' | 'skipped' | 'in_progress') {
    await this.authz.require(ctx, 'edit_content');
    const c = await this.db.campaigns.require(ctx.businessId, id); const t = c.tasks.find((x) => x.key === key); if (!t) throw new ValidationError(`Unknown task ${key}`);
    if (status === 'done' && t.deliverableId) { const d = await this.db.deliverables.get(ctx.businessId, t.deliverableId); if (d?.status !== 'approved') throw new ConflictError('Approve the deliverable before marking this task done', 'not_approved'); }
    if (status !== 'skipped' && t.status === 'blocked') throw new ConflictError('Task is blocked by incomplete dependencies', 'dependency_not_complete');
    const tasks = c.tasks.map((x) => (x.key === key ? { ...x, status } : x));
    const upd = await this.db.campaigns.update(ctx.businessId, id, { tasks: refreshStatuses(tasks), startDate: c.startDate ?? nowIso().slice(0, 10), status: 'active' }, c.version);
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'campaign.task_' + status, entityType: 'campaign', entityId: id, detail: { key } });
    return upd;
  }
}
