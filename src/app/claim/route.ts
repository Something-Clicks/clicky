import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { log } from "@/lib/log";
import { PREVIEW_COOKIE } from "@/lib/server/preview";
import { track } from "@/lib/server/site";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;

/**
 * Completes Save this. Reached from the emailed sign-in link (any browser). The database
 * checks the single-use claim token AND that the signed-in user's verified email is the
 * address the result was saved with.
 */
export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get("t") ?? "";
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));
  if (!TOKEN.test(t)) return to("/claim-problem?reason=invalid");

  const user = await getUser();
  if (!user) {
    // Signed out (e.g. the link was opened after signing out): sign in with the same email.
    return to(`/login?claim=1&next=${encodeURIComponent(`/claim?t=${t}`)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_preview", { p_claim: t });
  if (error) {
    const hint = (error as { hint?: string }).hint ?? "invalid";
    log.info("preview.claim_refused", { userId: user.id, hint });
    return to(`/claim-problem?reason=${encodeURIComponent(hint)}`);
  }
  log.info("preview.claimed", { userId: user.id });
  await track("signup_completed", { from: "save_this" });
  await track("free_use_consumed", { n: 1 });
  const res = to("/app?welcome=1");
  res.cookies.delete(PREVIEW_COOKIE);
  return res;
}
