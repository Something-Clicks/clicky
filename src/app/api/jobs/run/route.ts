import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getContainer } from '@/server/container';
import { env } from '@/server/env';
import { queueScheduledReviews } from '@/server/scheduled';

export const runtime = 'nodejs'; export const maxDuration = 300;
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Runner endpoint for any scheduler (Vercel Cron today, Trigger.dev later). Resumes stuck runs and executes queued ones.
 * Body: { businessId, executionId } to run one job, or { businessId } to recover stale runs for a tenant.
 */
const authorised = (req: Request) => { const tok = (req.headers.get('authorization') ?? '').replace(/^Bearer /, ''); return !!env.cronSecret && same(tok, env.cronSecret); };
/** Vercel Cron calls GET with the CRON_SECRET bearer token: queues the weekly scheduled reviews. */
export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { agent, db, entitlements } = getContainer(); return NextResponse.json(await queueScheduledReviews(db, agent, entitlements));
}
export async function POST(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { agent } = getContainer(); const body = (await req.json().catch(() => ({}))) as { businessId?: string; executionId?: string };
  if (!body.businessId) return NextResponse.json({ error: 'businessId required' }, { status: 400 });
  if (body.executionId) { const r = await agent.orchestrator.run(body.businessId, body.executionId); return NextResponse.json({ status: r.status }); }
  return NextResponse.json({ recovered: await agent.orchestrator.recoverStale(body.businessId) });
}
