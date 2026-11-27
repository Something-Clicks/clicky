import { NextResponse } from 'next/server';
import { AppError } from '@/agent/core/errors';
import { handleWebhook } from '@/server/billing/stripe';
import { getServerContainer } from '@/server/container';

export const runtime = 'nodejs';
/** Stripe calls this directly. The raw body is verified against the signing secret before anything is read from it. */
export async function POST(req: Request) {
  const raw = await req.text();
  try { const r = await handleWebhook((await getServerContainer()).db, raw, req.headers.get('stripe-signature')); return NextResponse.json({ received: true, ...r }); }
  catch (e) { return NextResponse.json({ error: e instanceof AppError ? e.message : 'error' }, { status: e instanceof AppError ? e.status : 500 }); }
}
