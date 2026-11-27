import { ConflictError, ForbiddenError, mockForbidden, ValidationError } from '../core/errors';
import { hashContent, nowIso } from '../core/util';
import type { DeliverableRow, ExecActionKind, ExecutionRequestRow } from '../domain/models';
import type { Ctx } from '../store/authz';
import { Authz } from '../store/authz';
import type { AuditLog } from '../store/audit';
import type { Db } from '../store/db';
import type { CardService } from './cards';
import { DeliverableService } from './content';
import { OPEN_GATE, type PlanGate } from '../plans';

/** Actions the agent/platform may NEVER perform on its own, regardless of approvals. Spec §10.2. */
export const FORBIDDEN_ACTIONS: ExecActionKind[] = ['spend_ad_budget', 'change_billing', 'modify_account', 'make_contract_promise', 'commit_third_party_service'];
/** Actions that need a connected, authorised integration. No integration is bundled in this build. */
export const INTEGRATION_ACTIONS: ExecActionKind[] = ['publish_website', 'send_email_campaign', 'schedule_social_post'];

export interface AdapterContext { businessId: string; request: ExecutionRequestRow; deliverable: DeliverableRow; content: string; actorUserId: string; actorEmail?: string }
export interface AdapterResult { externalRef?: string; detail: string }
export interface ExecutionAdapter {
  readonly action: ExecActionKind;
  /** Safe to run again if a previous attempt failed (idempotent at the destination). */
  readonly safeToRetry: boolean;
  execute(c: AdapterContext): Promise<AdapterResult>;
  /** Independently confirm the effect actually happened. */
  verify(c: AdapterContext, r: AdapterResult): Promise<{ ok: boolean; detail: string }>;
}

/** Sends one test copy of an approved email to a member of the business. Interface only: Resend implements it in the app layer. */
export interface EmailSender { send(msg: { to: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<{ id: string }> }

export class ExecutionService {
  private adapters = new Map<ExecActionKind, ExecutionAdapter>();
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog, private readonly cards: CardService, adapters: ExecutionAdapter[] = [], private readonly gate: PlanGate = OPEN_GATE) {
    for (const a of adapters) this.adapters.set(a.action, a);
  }
  register(a: ExecutionAdapter) { this.adapters.set(a.action, a); }
  available(action: ExecActionKind): boolean { return !FORBIDDEN_ACTIONS.includes(action) && this.adapters.has(action); }
  availableActions(): ExecActionKind[] { return [...this.adapters.keys()]; }

  /** Step 1: create a request for an APPROVED deliverable. A request is not permission. */
  async request(ctx: Ctx, input: { deliverableId: string; action: ExecActionKind; target?: Record<string, string> }, requestedBy: 'agent' | 'user' = 'user'): Promise<ExecutionRequestRow> {
    await this.authz.require(ctx, 'edit_content'); await this.gate.require(ctx, 'approval_execution');
    if (FORBIDDEN_ACTIONS.includes(input.action)) { await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'execution.blocked', entityType: 'deliverable', entityId: input.deliverableId, detail: { action: input.action, reason: 'forbidden_action' } }); throw new ForbiddenError(`"${input.action}" can never be performed by the agent`, 'forbidden_action'); }
    if (!this.adapters.has(input.action)) throw new ConflictError(`No connected integration for "${input.action}". Export the approved draft or record it as completed instead.`, 'integration_unavailable');
    const d = await this.db.deliverables.require(ctx.businessId, input.deliverableId);
    if (d.versions.some((v) => v.mock) && mockForbidden()) throw new ForbiddenError('Mock-generated content cannot be actioned', 'mock_content');
    if (d.status !== 'approved' || !d.approval) throw new ForbiddenError('The deliverable must be approved before any action can be requested', 'not_approved');
    const cur = d.versions.find((v) => v.n === d.currentVersion)!;
    if (d.approval.version !== cur.n || d.approval.contentHash !== cur.contentHash) throw new ForbiddenError('Approval does not cover the current content', 'approval_stale');
    const key = hashContent({ b: ctx.businessId, d: d.id, v: cur.n, a: input.action, t: input.target ?? {} });
    const dup = (await this.db.executionRequests.list(ctx.businessId, { idempotencyKey: key })).find((r) => !['failed', 'cancelled', 'rejected'].includes(r.status));
    if (dup) return dup;
    const row = await this.db.executionRequests.insert({ businessId: ctx.businessId, action: input.action, deliverableId: d.id, deliverableVersion: cur.n, contentHash: cur.contentHash, requestedBy: requestedBy === 'agent' ? 'agent' : ctx.userId, status: 'requested', idempotencyKey: key, attempts: 0, target: input.target });
    await this.audit.record({ businessId: ctx.businessId, actorType: requestedBy === 'agent' ? 'agent' : 'user', actorId: requestedBy === 'agent' ? 'agent' : ctx.userId, action: 'execution.requested', entityType: 'execution_request', entityId: row.id, detail: { action: input.action, deliverableId: d.id } });
    return row;
  }

  /** Step 2: a human with the right role authorises. Only users can; there is no agent path to this method. */
  async authorize(ctx: Ctx, requestId: string, note?: string): Promise<ExecutionRequestRow> {
    await this.authz.require(ctx, 'authorize_execution');
    const r = await this.db.executionRequests.require(ctx.businessId, requestId);
    if (r.status !== 'requested') throw new ConflictError(`Request is ${r.status}`, 'invalid_state');
    await this.assertStillApproved(r);
    const upd = await this.db.executionRequests.update(ctx.businessId, requestId, { status: 'authorized', authorization: { by: ctx.userId, at: nowIso(), note } }, r.version);
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'execution.authorized', entityType: 'execution_request', entityId: requestId, detail: { note } });
    return upd;
  }

  async cancel(ctx: Ctx, requestId: string): Promise<ExecutionRequestRow> {
    await this.authz.require(ctx, 'authorize_execution');
    const r = await this.db.executionRequests.require(ctx.businessId, requestId);
    if (!['requested', 'authorized', 'failed'].includes(r.status)) throw new ConflictError(`Cannot cancel a request that is ${r.status}`, 'invalid_state');
    return this.db.executionRequests.update(ctx.businessId, requestId, { status: 'cancelled' }, r.version);
  }

  private async assertStillApproved(r: ExecutionRequestRow): Promise<DeliverableRow> {
    const d = await this.db.deliverables.require(r.businessId, r.deliverableId);
    const cur = d.versions.find((v) => v.n === d.currentVersion)!;
    if (d.status !== 'approved' || d.approval?.contentHash !== r.contentHash || cur.contentHash !== r.contentHash)
      throw new ForbiddenError('Content changed or approval was withdrawn after this request was created', 'approval_stale');
    return d;
  }

  /** Step 3: execute. Atomic claim (compare-and-set on version) guarantees at-most-once concurrent execution. Step 4: independent verification. */
  async execute(ctx: Ctx, requestId: string, opts: { actorEmail?: string } = {}): Promise<ExecutionRequestRow> {
    await this.authz.require(ctx, 'authorize_execution');
    const r0 = await this.db.executionRequests.require(ctx.businessId, requestId);
    if (r0.status === 'executed' || r0.status === 'verified') return r0; // idempotent: never run twice
    if (r0.status !== 'authorized' || !r0.authorization) throw new ForbiddenError('Request has not been authorised by a person', 'not_authorized');
    if (FORBIDDEN_ACTIONS.includes(r0.action)) throw new ForbiddenError('Forbidden action', 'forbidden_action');
    const adapter = this.adapters.get(r0.action);
    if (!adapter) throw new ConflictError('Integration is not available', 'integration_unavailable');
    const d = await this.assertStillApproved(r0);
    let r: ExecutionRequestRow;
    try { r = await this.db.executionRequests.update(ctx.businessId, requestId, { status: 'executing', attempts: r0.attempts + 1 }, r0.version); }
    catch (e) { if ((e as { code?: string }).code === 'version_conflict') throw new ConflictError('This action is already being executed', 'already_executing'); throw e; }
    await this.cards.setStatus(ctx.businessId, d.cardId ?? '', 'executing', { type: 'system', id: 'execution' }).catch(() => undefined);
    const ac: AdapterContext = { businessId: ctx.businessId, request: r, deliverable: d, content: DeliverableService.render(d, 'markdown'), actorUserId: ctx.userId, actorEmail: opts.actorEmail };
    try {
      const res = await adapter.execute(ac);
      const v = await adapter.verify(ac, res);
      const out = await this.db.executionRequests.update(ctx.businessId, requestId, { status: v.ok ? 'verified' : 'executed', result: { externalRef: res.externalRef, detail: `${res.detail} | verification: ${v.detail}`, verified: v.ok, at: nowIso() } });
      if (d.cardId) await this.cards.setStatus(ctx.businessId, d.cardId, v.ok ? 'verified' : 'executed', { type: 'system', id: 'execution' }).catch(() => undefined);
      await this.audit.record({ businessId: ctx.businessId, actorType: 'system', actorId: 'execution', action: v.ok ? 'execution.verified' : 'execution.unverified', entityType: 'execution_request', entityId: requestId, detail: { action: r.action, ref: res.externalRef, by: ctx.userId } });
      return out;
    } catch (e) {
      const err = e as Error & { code?: string };
      const out = await this.db.executionRequests.update(ctx.businessId, requestId, { status: 'failed', error: { code: err.code ?? 'adapter_error', message: err.message, at: nowIso() } });
      if (d.cardId) await this.cards.setStatus(ctx.businessId, d.cardId, 'failed', { type: 'system', id: 'execution' }, err.message).catch(() => undefined);
      await this.audit.record({ businessId: ctx.businessId, actorType: 'system', actorId: 'execution', action: 'execution.failed', entityType: 'execution_request', entityId: requestId, detail: { message: err.message } });
      return out;
    }
  }

  /** Retry a failed request only when the adapter declares it safe, with the same authorisation, up to 3 attempts. */
  async retry(ctx: Ctx, requestId: string, opts: { actorEmail?: string } = {}): Promise<ExecutionRequestRow> {
    await this.authz.require(ctx, 'authorize_execution');
    const r = await this.db.executionRequests.require(ctx.businessId, requestId);
    if (r.status !== 'failed') throw new ConflictError(`Request is ${r.status}`, 'invalid_state');
    if (!this.adapters.get(r.action)?.safeToRetry) throw new ForbiddenError('This action is not safe to retry automatically; create a new request', 'not_retryable');
    if (r.attempts >= 3) throw new ForbiddenError('Retry limit reached', 'retry_limit');
    await this.db.executionRequests.update(ctx.businessId, requestId, { status: 'authorized', error: undefined }, r.version);
    return this.execute(ctx, requestId, opts);
  }

  async list(ctx: Ctx, deliverableId?: string) { await this.authz.require(ctx, 'view'); return this.db.executionRequests.list(ctx.businessId, deliverableId ? { deliverableId } : undefined, { newestFirst: true }); }
}

// ------------- Built-in adapters (no external service required) -------------
export const saveToWorkspaceAdapter = (db: Db): ExecutionAdapter => ({
  action: 'save_to_workspace', safeToRetry: true,
  async execute(c) { return { externalRef: `workspace:${c.deliverable.id}@v${c.request.deliverableVersion}`, detail: `Approved version ${c.request.deliverableVersion} saved to the workspace.` }; },
  async verify(c) { const d = await db.deliverables.get(c.businessId, c.deliverable.id); const v = d?.versions.find((x) => x.n === c.request.deliverableVersion); return { ok: !!v && v.contentHash === c.request.contentHash, detail: 'Stored version re-read and hash matched.' }; },
});
export const downloadExportAdapter = (): ExecutionAdapter => ({
  action: 'download_export', safeToRetry: true,
  async execute(c) { return { externalRef: `export:${c.request.contentHash.slice(0, 12)}`, detail: `Export of version ${c.request.deliverableVersion} prepared (${c.content.length} chars).` }; },
  async verify(c) { return { ok: hashContent(c.content).length > 0 && c.content.length > 0, detail: 'Export rendered from approved content.' }; },
});
/** The customer attests they carried it out themselves (e.g. pasted into their site). Recorded as customer-supplied, never as verified publishing. */
export const recordActivityAdapter = (audit: AuditLog): ExecutionAdapter => ({
  action: 'record_activity', safeToRetry: false,
  async execute(c) {
    await audit.record({ businessId: c.businessId, actorType: 'user', actorId: c.actorUserId, action: 'activity.completed', entityType: 'deliverable', entityId: c.deliverable.id, detail: { type: c.deliverable.type, version: c.request.deliverableVersion, url: c.request.target?.url ?? null, completedOn: c.request.target?.date ?? nowIso().slice(0, 10), attestedByCustomer: true } });
    return { detail: 'Completed activity recorded (customer-attested).' };
  },
  async verify() { return { ok: false, detail: 'Customer-attested; the platform cannot independently confirm publication.' }; },
});
export const testEmailAdapter = (db: Db, sender: EmailSender): ExecutionAdapter => ({
  action: 'send_transactional_email', safeToRetry: false,
  async execute(c) {
    const to = c.request.target?.to; if (!to) throw Object.assign(new ValidationError('Recipient required'), { code: 'no_recipient' });
    const members = await db.members.list(c.businessId);
    const ok = members.some((m) => m.userId === c.actorUserId); if (!ok) throw new ForbiddenError('Not a member');
    if (!c.actorEmail || to.toLowerCase() !== c.actorEmail.toLowerCase()) throw Object.assign(new ForbiddenError('Emails can only be sent to the authorising user', 'recipient_not_allowed'), {});
    const html = DeliverableService.render(c.deliverable, 'html'); const text = DeliverableService.render(c.deliverable, 'text');
    const subject = c.deliverable.versions.find((v) => v.n === c.request.deliverableVersion)!.blocks.find((b) => b.key === 'subject')?.text ?? c.deliverable.versions[0]!.title;
    const res = await sender.send({ to, subject: `[Test] ${subject}`, html, text, idempotencyKey: c.request.idempotencyKey });
    return { externalRef: res.id, detail: `Test copy sent to ${to}.` };
  },
  async verify(_c, r) { return { ok: !!r.externalRef, detail: 'Email provider returned a message id (delivery not confirmed).' }; },
});
