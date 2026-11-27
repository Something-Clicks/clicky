import { daysBetween, nowIso } from '@/agent/core/util';
import type { Agent } from '@/agent/orchestrator/agent';
import type { Db } from '@/agent/store/db';
import type { Entitlements } from './billing/entitlements';

/**
 * "Regular website reviews" (Marketing Assistant and up): for every active subscription whose plan includes ongoing reviews,
 * queue a fresh review of each website the plan covers when the last one is older than `everyDays`. Reviews do not use drafts
 * and do not prepare any; they only update findings and mark fixed issues resolved. Run from any scheduler (see /api/jobs/run).
 */
export async function queueScheduledReviews(db: Db, agent: Agent, ent: Entitlements, everyDays = 7): Promise<{ queued: number; skipped: number }> {
  let queued = 0, skipped = 0;
  for (const bill of await db.billing.listAcross({})) {
    const sub = bill.subscription; if (!sub || !['active', 'trialing'].includes(sub.status)) continue;
    const biz = await db.businesses.get(bill.businessId, bill.businessId); if (!biz) continue;
    const ctx = { userId: bill.userId, businessId: bill.businessId };
    if (!(await ent.has(ctx, 'ongoing_reviews'))) { skipped++; continue; }
    const runs = await db.workflows.list(bill.businessId, { taskType: 'website_audit' }, { newestFirst: true });
    for (const site of await agent.sites.usable(ctx)) {
      if (!site.url) continue;
      const last = runs.find((r) => (r.siteId ?? r.businessId) === site.id && ['succeeded', 'queued', 'running'].includes(r.status));
      if (last && daysBetween(last.completedAt ?? last.createdAt, nowIso()) < everyDays) { skipped++; continue; }
      try { await agent.orchestrator.submit({ ...ctx, siteId: site.id }, { request: 'Scheduled website review', taskType: 'website_audit', params: { url: site.url, rescan: true, noDrafts: true } }); queued++; }
      catch { skipped++; }
    }
  }
  return { queued, skipped };
}
