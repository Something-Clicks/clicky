import { NextResponse } from 'next/server';
import { getWorkspace } from '@/server/auth';
import { env } from '@/server/env';

/** DEV_MODE only (404 everywhere else): lets browser tests learn the signed-in user's ids to sign a Stripe test event. */
export async function GET() {
  if (!env.devMode || env.isProd) return new NextResponse('Not found', { status: 404 });
  const w = await getWorkspace(); return w ? NextResponse.json({ userId: w.user.id, businessId: w.ctx.businessId }) : new NextResponse('Not found', { status: 404 });
}
