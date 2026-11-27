import { ForbiddenError } from '@/agent/core/errors';

import type { TaskType } from '@/agent/domain/enums';
import type { BillingRow, WorkflowExecutionRow } from '@/agent/domain/models';
import { OUTPUT_TASKS } from '@/agent/orchestrator/workflows';
import { planRequired, type Feature, type PlanGate } from '@/agent/plans';
import type { Ctx } from '@/agent/store/authz';
import type { Db } from '@/agent/store/db';
import { FREE_USES, minPlanFor, PLAN_FEATURES, PLAN_NAME, QUOTAS, type PlanId, type SubscriptionPlan } from './plans';

export { FREE_USES };
const ACTIVE = new Set(['active', 'trialing']);

export interface UsageStatus {
  plan: PlanId; planName: string; features: Feature[]; subscriptionStatus?: string; periodEnd?: string;
  freeUsed: number; freeRemaining: number; reportCredits: number;
  draftsUsed?: number; draftsLimit?: number; draftsRemaining?: number; maxSites: number; maxLocations: number;
  canStartOutput: boolean; reason?: string;
}

/** The billing-backed PlanGate: the single place that turns "what has this customer paid for" into "what may the agent do". */
export class Entitlements implements PlanGate {
  constructor(private readonly db: Db) {}

  private async billing(userId: string, businessId: string): Promise<BillingRow | undefined> { return (await this.db.billing.list(businessId, { userId }))[0]; }
  private async owner(ctx: Ctx): Promise<string> { return ctx.userId; }
  private async userUses(userId: string) { return this.db.uses.listAcross({ userId }); }
  /** Runs that have been accepted but not yet saved reserve allowance, so parallel requests cannot overshoot. A run never counts against itself. */
  private async inflight(userId: string, exceptRun?: string) { return (await this.db.workflows.listAcross({ userId })).filter((w) => w.id !== exceptRun && (w.status === 'queued' || w.status === 'running') && OUTPUT_TASKS.includes(w.taskType)); }
  private activeSub(b?: BillingRow) { const s = b?.subscription; return s && ACTIVE.has(s.status) ? s : undefined; }

  async status(ctx: Ctx): Promise<UsageStatus> {
    const userId = await this.owner(ctx);
    const [bill, uses, flying] = await Promise.all([this.billing(userId, ctx.businessId), this.userUses(userId), this.inflight(userId, ctx.runId)]);
    const freeUsed = uses.filter((u) => u.kind !== 'draft').length + flying.length; const freeRemaining = Math.max(0, FREE_USES - freeUsed);
    const credits = Math.max(0, (bill?.reportCredits ?? 0) - uses.filter((u) => u.paidCredit).length); const sub = this.activeSub(bill);
    if (sub) {
      const q = QUOTAS[sub.plan as SubscriptionPlan]; const used = uses.filter((u) => u.kind === 'draft' && u.createdAt >= sub.currentPeriodStart).length; const left = Math.max(0, q.drafts - used);
      return { plan: sub.plan as PlanId, planName: PLAN_NAME[sub.plan as PlanId], features: PLAN_FEATURES[sub.plan as PlanId], subscriptionStatus: sub.status, periodEnd: sub.currentPeriodEnd, freeUsed, freeRemaining, reportCredits: credits, draftsUsed: used, draftsLimit: q.drafts, draftsRemaining: left, maxSites: q.sites, maxLocations: q.locations, canStartOutput: true };
    }
    const f = new Set<Feature>(); if (freeRemaining > 0) PLAN_FEATURES.free.forEach((x) => f.add(x)); if (credits > 0) PLAN_FEATURES.report.forEach((x) => f.add(x));
    const can = f.size > 0;
    return { plan: freeRemaining > 0 ? 'free' : credits > 0 ? 'report' : 'free', planName: freeRemaining > 0 ? PLAN_NAME.free : credits > 0 ? PLAN_NAME.report : 'No active plan', features: [...f], subscriptionStatus: bill?.subscription?.status, freeUsed, freeRemaining, reportCredits: credits, maxSites: 1, maxLocations: 1, canStartOutput: can, reason: can ? undefined : `You have used your ${FREE_USES} free uses. Choose a plan to continue.` };
  }

  // ---- PlanGate ----
  async has(ctx: Ctx, feature: Feature): Promise<boolean> { return (await this.status(ctx)).features.includes(feature); }
  async require(ctx: Ctx, feature: Feature): Promise<void> {
    const s = await this.status(ctx);
    if (s.features.includes(feature)) return;
    if (!s.canStartOutput) throw new ForbiddenError(s.reason ?? 'Choose a plan to continue.', 'usage_limit');
    throw planRequired(feature, minPlanFor(feature));
  }
  async draftsRemaining(ctx: Ctx): Promise<number> { const s = await this.status(ctx); return s.draftsRemaining ?? Infinity; }
  async limits(ctx: Ctx) { const s = await this.status(ctx); return { maxSites: s.maxSites, maxLocations: s.maxLocations }; }

  /** Called BEFORE any model work is queued. Refusals here never count as a use. */
  async assertCanStart(ctx: Ctx, taskType: TaskType): Promise<void> {
    if (!OUTPUT_TASKS.includes(taskType)) return;
    const s = await this.status(ctx);
    if (s.subscriptionStatus && s.plan !== 'free' && s.plan !== 'report') return; // subscribers: reviews are not metered; drafts are metered where they are created
    if (!s.canStartOutput) throw new ForbiddenError(s.reason ?? 'Usage limit reached', 'usage_limit');
  }

  /** Called ONLY when a completed output has been saved. Failed, blocked and retried attempts never reach here. */
  async recordUse(ctx: Ctx, o: { executionId?: string; task: string; previewId?: string; kind?: 'output' | 'preview' | 'draft' }): Promise<void> {
    if (o.executionId && (await this.db.uses.list(ctx.businessId, { executionId: o.executionId })).length) return; // exactly once per run
    const userId = await this.owner(ctx); const before = await this.userUses(userId); const bill = await this.billing(userId, ctx.businessId);
    // A paid Marketing Report credit is consumed by writing a ledger row (billing rows are read-only for customers).
    const paidCredit = !this.activeSub(bill) && FREE_USES - before.filter((u) => u.kind !== 'draft').length <= 0 && o.task === 'website_audit' && !!bill && bill.reportCredits - before.filter((u) => u.paidCredit).length > 0;
    await this.db.uses.insert({ businessId: ctx.businessId, userId, kind: o.kind ?? 'output', executionId: o.executionId, previewId: o.previewId, task: o.task, ...(paidCredit ? { paidCredit: true } : {}) });
  }
  /** A workflow finished: subscribers are charged one draft per draft created; free/report customers one use per saved output. */
  async onCompleted(ctx: Ctx, exec: WorkflowExecutionRow) {
    const bill = await this.billing(ctx.userId, ctx.businessId);
    if (this.activeSub(bill)) { const n = (exec.state.draftsCreated as number | undefined) ?? 0; for (let i = 0; i < n; i++) await this.db.uses.insert({ businessId: ctx.businessId, userId: ctx.userId, kind: 'draft', executionId: `${exec.id}#${i}`, task: exec.taskType }); return; }
    await this.recordUse(ctx, { executionId: exec.id, task: exec.taskType });
  }
  /** A single draft written outside a workflow (from an Action Card or a campaign task). */
  async recordDeliverable(ctx: Ctx, deliverableId: string) {
    const bill = await this.billing(ctx.userId, ctx.businessId);
    await this.recordUse(ctx, { executionId: `deliverable:${deliverableId}`, task: 'deliverable', kind: this.activeSub(bill) ? 'draft' : 'output' });
  }
}
