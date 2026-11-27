import { AppError, ConflictError, ForbiddenError, NeedsInputError, ValidationError } from '../core/errors';
import { hashContent, normalizeText, nowIso, daysBetween } from '../core/util';
import { TaskType, type TaskType as TaskTypeT } from '../domain/enums';
import type { StepRecord, WorkflowExecutionRow } from '../domain/models';
import { z } from 'zod';
import { zeroUsage, type Usage } from '../providers/usage';
import type { RateLimiter } from '../security/ratelimit';
import { inSite, siteOf, type Ctx } from '../store/authz';
import { draftFeature } from '../plans';
import { DeliverableType as DT } from '../domain/enums';
import type { Agent } from './agent';
import { CAPABILITIES } from './capabilities';
import { classifyByRules, inferDeliverableType } from './classify';
import type { Params, RunEnv, RunState } from './types';
import { TASK_FEATURE, TASK_LABEL, WORKFLOWS } from './workflows';

/** Long work never runs inside a web request: submit() enqueues, a queue implementation (after(), cron, Trigger.dev) calls run(). */
export interface JobQueue { enqueue(job: { businessId: string; executionId: string }): void | Promise<void> }
/** Collects jobs for tests and for external runners that poll (see claimQueued). */
export class ManualQueue implements JobQueue { jobs: { businessId: string; executionId: string }[] = []; enqueue(j: { businessId: string; executionId: string }) { this.jobs.push(j); } }

export interface OrchestratorHooks {
  /** Called before any model work is queued; throw to refuse (entitlement / billing gate lives in the app layer). */
  beforeSubmit?(ctx: Ctx, taskType: TaskTypeT, params: Params): Promise<void>;
  /** Called once when a run finished and its outputs were SAVED. Errors, blocked attempts and retries never reach here. */
  onCompleted?(ctx: Ctx, exec: WorkflowExecutionRow): Promise<void>;
}

const RETRYABLE = new Set(['provider_error']);
const MAX_STEP_ATTEMPTS = 2;

export class Orchestrator {
  constructor(private readonly agent: Agent, private readonly queue: JobQueue, private readonly limiter: RateLimiter, private readonly hooks: OrchestratorHooks = {}) {}
  private get db() { return this.agent.db; }

  async classify(request: string, usage: { current: Usage }): Promise<TaskTypeT | undefined> {
    const byRule = classifyByRules(request); if (byRule) return byRule;
    try {
      const r = await this.agent.llm.generate({ task: 'classify_request', usage, schema: z.object({ taskType: TaskType }), instructions: `Classify the marketing request into exactly one taskType: ${TaskType.options.join(', ')}.`, input: { request } });
      return r.data.taskType;
    } catch { return undefined; }
  }

  async get(ctx: Ctx, id: string): Promise<WorkflowExecutionRow> { await this.agent.authz.require(ctx, 'view'); return this.db.workflows.require(ctx.businessId, id); }
  async list(ctx: Ctx, limit = 20): Promise<WorkflowExecutionRow[]> { await this.agent.authz.require(ctx, 'view'); return (await this.db.workflows.list(ctx.businessId, undefined, { newestFirst: true })).filter((w) => inSite(w, ctx)).slice(0, limit); }

  /** Receive request → identify task → authorise → check information → build plan → (dedupe) → enqueue. */
  async submit(ctx: Ctx, input: { request: string; taskType?: TaskTypeT; params?: Params }): Promise<WorkflowExecutionRow> {
    await this.agent.authz.require(ctx, 'run_agent');
    // The active site must be one of THIS business's sites, and one the plan lets the customer work in.
    if (siteOf(ctx) !== ctx.businessId && !(await this.agent.sites.usable(ctx)).some((s) => s.id === siteOf(ctx))) throw new ForbiddenError('That website is not available on your plan', 'site_unavailable');
    const request = input.request.trim().slice(0, 4000);
    if (request.length < 3 && !input.taskType) throw new ValidationError('Tell the agent what you need help with');
    const usage = { current: zeroUsage() };
    const taskType = input.taskType ?? (await this.classify(request, usage));
    if (!taskType) return this.record(ctx, { request, taskType: 'content_request', params: input.params ?? {}, status: 'needs_input', questions: ['I could not tell what you want. Try e.g. "Improve my homepage headline", "Research my competitors", "Develop a marketing plan", or "Prepare a campaign for <service>".'] });
    const params = input.params ?? {}; const caps = WORKFLOWS[taskType];
    const questions: string[] = [];
    for (const id of caps) { const c = CAPABILITIES[id as keyof typeof CAPABILITIES]; if (c.preflight) questions.push(...await c.preflight({ agent: this.agent, ctx, params, taskType, request })); }
    if (questions.length) return this.record(ctx, { request, taskType, params, status: 'needs_input', questions });

    // Plan check first, with a clear message. (Services enforce the same limits again.)
    await this.agent.gate.require(ctx, TASK_FEATURE[taskType]);
    if (taskType === 'content_request') { const dt = DT.safeParse(params.deliverableType ?? inferDeliverableType(request)); if (dt.success) await this.agent.gate.require(ctx, draftFeature(dt.data)); }
    const key = hashContent({ b: ctx.businessId, s: siteOf(ctx), t: taskType, r: normalizeText(request), p: { ...params, keywordCsv: params.keywordCsv ? hashContent(params.keywordCsv) : undefined } });
    const recent = (await this.db.workflows.list(ctx.businessId, { idempotencyKey: key }, { newestFirst: true, limit: 3 }))
      .find((w) => w.status === 'queued' || w.status === 'running' || (w.status === 'succeeded' && daysBetween(w.completedAt ?? w.createdAt, nowIso()) < 5 / 1440));
    if (recent) return recent;
    this.limiter.take(`${ctx.businessId}:${ctx.userId}`);
    await this.hooks.beforeSubmit?.(ctx, taskType, params);
    const row = await this.record(ctx, { request, taskType, params, status: 'queued', idempotencyKey: key });
    await this.agent.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'workflow.submitted', entityType: 'workflow', entityId: row.id, detail: { taskType, capabilities: caps } });
    await this.queue.enqueue({ businessId: ctx.businessId, executionId: row.id });
    return row;
  }

  private async record(ctx: Ctx, o: { request: string; taskType: TaskTypeT; params: Params; status: WorkflowExecutionRow['status']; questions?: string[]; idempotencyKey?: string }) {
    const caps = WORKFLOWS[o.taskType];
    const { keywordCsv, ...safeParams } = o.params;
    return this.db.workflows.insert({
      businessId: ctx.businessId, siteId: siteOf(ctx), userId: ctx.userId, request: o.request, taskType: o.taskType, params: { ...safeParams, ...(keywordCsv ? { keywordCsv } : {}) } as Record<string, unknown>, requiredCapabilities: caps, status: o.status,
      steps: caps.map((capability): StepRecord => ({ capability, status: 'pending', attempts: 0, usage: zeroUsage() })), state: {}, questions: o.questions ?? [], limitations: [], usage: zeroUsage(), models: [],
      approvalRequirements: ['Every deliverable needs your review and approval before any action.', 'Nothing is published, sent or spent automatically.'], idempotencyKey: o.idempotencyKey ?? `nokey:${Math.random()}`, mock: false,
    });
  }

  /** Executes (or resumes) a queued run. Completed steps are checkpointed and skipped, so retries never redo or duplicate work. */
  async run(businessId: string, executionId: string): Promise<WorkflowExecutionRow> {
    let exec = await this.db.workflows.require(businessId, executionId);
    if (exec.status !== 'queued') return exec;
    try { exec = await this.db.workflows.update(businessId, executionId, { status: 'running', startedAt: exec.startedAt ?? nowIso() }, exec.version); }
    catch (e) { if ((e as AppError).code === 'version_conflict') return this.db.workflows.require(businessId, executionId); throw e; }
    const ctx: Ctx = { userId: exec.userId, businessId, siteId: exec.siteId, runId: executionId };
    const env: RunEnv = { agent: this.agent, ctx, exec, params: exec.params as Params, state: exec.state as RunState, usage: { current: exec.usage }, limitations: [...exec.limitations], questions: [...exec.questions], mock: { value: exec.mock }, models: new Set(exec.models) };
    const steps = exec.steps.map((s) => ({ ...s }));
    const persist = async (patch: Partial<WorkflowExecutionRow>) => { exec = await this.db.workflows.update(businessId, executionId, { steps, state: env.state, usage: env.usage.current, limitations: [...new Set(env.limitations)], questions: [...new Set(env.questions)], models: [...env.models], mock: env.mock.value, ...patch }); };

    for (const step of steps) {
      if (step.status === 'succeeded' || step.status === 'skipped' || step.status === 'degraded') continue;
      const cap = CAPABILITIES[step.capability as keyof typeof CAPABILITIES];
      const before = env.usage.current; step.status = 'running'; step.startedAt = nowIso(); await persist({});
      let done = false;
      while (!done && step.attempts < MAX_STEP_ATTEMPTS) {
        step.attempts++;
        try {
          step.summary = await cap.run({ ...env, exec });
          step.status = 'succeeded'; done = true;
        } catch (e) {
          const err = e as AppError;
          if (err instanceof NeedsInputError) { step.status = 'pending'; env.questions.push(...err.questions); await persist({ status: 'needs_input', completedAt: nowIso() }); return exec; }
          if (RETRYABLE.has(err.code) && err.retryable && step.attempts < MAX_STEP_ATTEMPTS) continue;
          step.error = { code: err.code ?? 'internal_error', message: err.message };
          if (typeof cap.optional === 'function' ? cap.optional(exec.taskType) : cap.optional) { step.status = 'degraded'; env.limitations.push(`${step.capability.replace(/_/g, ' ')} was skipped: ${err.message}`); done = true; }
          else { step.status = 'failed'; step.completedAt = nowIso(); step.usage = diff(env.usage.current, before); await persist({ status: 'failed', completedAt: nowIso(), error: step.error }); await this.agent.audit.record({ businessId, actorType: 'system', actorId: 'orchestrator', action: 'workflow.failed', entityType: 'workflow', entityId: executionId, detail: { step: step.capability, code: step.error.code } }); return exec; }
        }
      }
      step.completedAt = nowIso(); step.usage = diff(env.usage.current, before); await persist({});
    }
    const saved = !!(env.state.cardIds?.length || env.state.deliverableIds?.length || env.state.strategyId || env.state.campaignId || env.state.reportId || env.state.researchIds?.length || env.state.scanId);
    await persist({ status: 'succeeded', completedAt: nowIso() });
    await this.db.usage.insert({ businessId, userId: exec.userId, task: exec.taskType, model: [...env.models].join(',') || 'none', provider: this.agent.llm.provider.name, inputTokens: exec.usage.inputTokens, outputTokens: exec.usage.outputTokens, costUsd: exec.usage.costUsd, executionId });
    await this.agent.audit.record({ businessId, actorType: 'agent', actorId: 'agent', action: 'workflow.completed', entityType: 'workflow', entityId: executionId, detail: { taskType: exec.taskType, label: TASK_LABEL[exec.taskType], usage: exec.usage } });
    if (saved) await this.hooks.onCompleted?.(ctx, exec);
    return exec;
  }

  /** A run stuck in "running" (crashed worker) goes back to the queue; checkpoints make resuming safe. */
  async recoverStale(businessId: string, olderThanMinutes = 15): Promise<number> {
    let n = 0;
    for (const w of await this.db.workflows.list(businessId, { status: 'running' })) {
      if (daysBetween(w.updatedAt, nowIso()) * 1440 < olderThanMinutes) continue;
      await this.db.workflows.update(businessId, w.id, { status: 'queued', steps: w.steps.map((s) => (s.status === 'running' ? { ...s, status: 'pending' as const } : s)) }, w.version);
      await this.queue.enqueue({ businessId, executionId: w.id }); n++;
    }
    return n;
  }

  /** A failed run can be retried explicitly (no automatic duplicate side-effects: steps are checkpointed). Does not count as a use. */
  async retry(ctx: Ctx, id: string): Promise<WorkflowExecutionRow> {
    await this.agent.authz.require(ctx, 'run_agent');
    const w = await this.db.workflows.require(ctx.businessId, id);
    if (w.status !== 'failed') throw new ConflictError(`Run is ${w.status}`, 'invalid_state');
    const steps = w.steps.map((s) => (s.status === 'failed' ? { ...s, status: 'pending' as const, attempts: 0, error: undefined } : s));
    const upd = await this.db.workflows.update(ctx.businessId, id, { status: 'queued', steps, error: undefined }, w.version);
    await this.queue.enqueue({ businessId: ctx.businessId, executionId: id });
    return upd;
  }
}
const diff = (a: Usage, b: Usage): Usage => ({ inputTokens: a.inputTokens - b.inputTokens, outputTokens: a.outputTokens - b.outputTokens, costUsd: a.costUsd - b.costUsd, calls: a.calls - b.calls });
