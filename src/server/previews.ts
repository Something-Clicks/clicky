import { createHash, randomBytes } from 'node:crypto';
import { AppError, ForbiddenError, NotFoundError, RateLimitError, ValidationError } from '@/agent/core/errors';
import { daysBetween, nowIso } from '@/agent/core/util';
import { runPreviewAnalysis } from '@/agent/preview';
import type { Agent } from '@/agent/orchestrator/agent';
import type { Ctx } from '@/agent/store/authz';
import type { Db } from '@/agent/store/db';
import { createBusiness } from '@/agent/profile/bootstrap';
import { parseSafeUrl } from '@/agent/website/url-guard';
import type { Entitlements } from './billing/entitlements';
import { env } from './env';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const PUBLIC = 'public'; // previews have no tenant yet

export class PreviewService {
  constructor(private readonly db: Db, private readonly agent: Agent, private readonly ent: Entitlements) {}

  /** Validates input, enforces abuse limits, stores a queued preview, returns the (secret) token. The caller schedules run(). */
  async start(input: { url: string; zip: string; ip: string }): Promise<{ token: string; id: string }> {
    if (!env.anonymousPreview) throw new ForbiddenError('The free preview is not open yet. Create an account to get started.', 'preview_disabled');
    const zip = input.zip.trim(); if (!/^\d{5}$/.test(zip)) throw new ValidationError('Enter a 5-digit ZIP code');
    const url = parseSafeUrl(input.url); // SSRF / scheme validation up front
    const ipHash = hash(env.hashSalt + input.ip);
    const recent = (await this.db.previews.list(PUBLIC)).filter((p) => daysBetween(p.createdAt, nowIso()) < 1);
    if (recent.filter((p) => p.ipHash === ipHash).length >= env.previewPerIpPerDay) throw new RateLimitError('You have reached the daily limit for free previews. Create an account to continue.');
    if (recent.length >= env.previewDailyCap) throw new RateLimitError('Free previews are at capacity today. Please try again tomorrow or create an account.');
    const token = randomBytes(24).toString('base64url');
    const row = await this.db.previews.insert({ businessId: PUBLIC, tokenHash: hash(token), url: url.origin + url.pathname, zip, ipHash, status: 'queued' });
    return { token, id: row.id };
  }

  async run(id: string): Promise<void> {
    const p = await this.db.previews.require(PUBLIC, id);
    if (p.status !== 'queued') return;
    await this.db.previews.update(PUBLIC, id, { status: 'running' }, p.version);
    try {
      const result = await runPreviewAnalysis({ llm: this.agent.llm, crawl: this.agent.crawl }, { url: p.url, zip: p.zip });
      await this.db.previews.update(PUBLIC, id, { status: 'complete', result });
    } catch (e) {
      await this.db.previews.update(PUBLIC, id, { status: 'failed', error: e instanceof AppError && e.status < 500 ? e.message : 'We could not complete the analysis. Please try again.' });
    }
  }

  async byToken(token: string) {
    const p = (await this.db.previews.list(PUBLIC, { tokenHash: hash(token) }))[0];
    if (!p) throw new NotFoundError('preview');
    return p;
  }

  /**
   * After signup the preview becomes the customer's first workspace: profile facts keep their provenance, findings become
   * Action Cards, and the completed (saved) preview counts as their first free use. Idempotent per user.
   */
  async claim(token: string, user: { id: string }): Promise<Ctx> {
    const p = await this.byToken(token);
    if (p.claimedBy && p.claimedBy !== user.id) throw new ForbiddenError('This preview was already claimed', 'already_claimed');
    if (p.claimedBy === user.id && p.claimedBusinessId) return { userId: user.id, businessId: p.claimedBusinessId };
    if (p.status !== 'complete' || !p.result) throw new ValidationError('The preview is not ready yet');
    const r = p.result; const domain = new URL(p.url).hostname.replace(/^www\./, '');
    const ctx = await createBusiness(this.db, this.agent.audit, user.id, { name: r.business.name ?? domain, website: p.url });
    await this.db.previews.update(PUBLIC, p.id, { claimedBy: user.id, claimedBusinessId: ctx.businessId });
    await this.db.scans.insert({ businessId: ctx.businessId, scan: r.scan, label: 'own_site' });
    await this.agent.profiles.applyUpdates(ctx, [
      { key: 'zip_codes', value: [p.zip], provenance: { source: 'customer_supplied', evidence: 'verified', sourceRef: 'intake form' } },
      ...r.profileUpdates.filter((u) => u.key !== 'name').map((u) => ({ key: u.key, value: u.value, provenance: { source: u.source as 'website' | 'ai_inference', evidence: u.evidence, sourceRef: u.sourceRef } })),
    ], { type: 'agent', id: 'agent' });
    await this.agent.cards.createFromFindings(ctx, r.findings, { actor: { type: 'agent', id: 'agent' } });
    await this.ent.recordUse(ctx, { task: 'preview', previewId: p.id, kind: 'preview' });
    return ctx;
  }
}
