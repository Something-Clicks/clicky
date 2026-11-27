import { NextResponse, type NextRequest } from 'next/server';
import { AppError } from '@/agent/core/errors';
import { DeliverableService } from '@/agent/capabilities/content';
import { getSessionUser } from '@/server/auth';
import { getContainer } from '@/server/container';

/** Serves a download only for an approved deliverable with a verified, authorised download request for exactly this content. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const rid = req.nextUrl.searchParams.get('rid'); const user = await getSessionUser();
  if (!user) return new NextResponse('Unauthorized', { status: 401 });
  const { db, agent } = getContainer();
  try {
    const m = (await db.members.listAcross({ userId: user.id }))[0]; if (!m) return new NextResponse('Not found', { status: 404 });
    const ctx = { userId: user.id, businessId: m.businessId };
    const d = await agent.deliverables.get(ctx, id); const r = rid ? await db.executionRequests.get(ctx.businessId, rid) : undefined;
    const cur = agent.deliverables.current(d);
    if (!r || r.deliverableId !== id || r.action !== 'download_export' || !['executed', 'verified'].includes(r.status) || r.contentHash !== cur.contentHash || d.status !== 'approved')
      return new NextResponse('This download has not been approved and authorised', { status: 403 });
    await agent.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: user.id, action: 'deliverable.exported', entityType: 'deliverable', entityId: id, detail: { rid } });
    return new NextResponse(DeliverableService.render(d, 'markdown'), { headers: { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': `attachment; filename="${d.type}-v${cur.n}.md"`, 'cache-control': 'private, no-store' } });
  } catch (e) { return new NextResponse(e instanceof AppError ? e.message : 'Error', { status: e instanceof AppError ? e.status : 500 }); }
}
