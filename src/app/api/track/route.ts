import { type NextRequest, NextResponse } from "next/server";

import { track, type FunnelEvent } from "@/lib/server/site";

/** Counts a few browser-side funnel steps. Counts only (no personal data). Same-origin posts only. */
const ALLOWED = new Set<FunnelEvent>(["pricing_viewed", "return_visit", "limit_reached", "upgrade_viewed"]);

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.nextUrl.host) return new NextResponse(null, { status: 403 });
  let event: unknown;
  try {
    event = ((await req.json()) as { event?: unknown }).event;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof event !== "string" || !ALLOWED.has(event as FunnelEvent)) return new NextResponse(null, { status: 400 });
  await track(event as FunnelEvent);
  return new NextResponse(null, { status: 204 });
}
