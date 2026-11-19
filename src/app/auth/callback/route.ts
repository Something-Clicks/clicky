import { NextResponse, type NextRequest } from "next/server";

import { log } from "@/lib/log";
import { safeNextPath } from "@/lib/redirect";
import { createClient } from "@/lib/supabase/server";

/** Email confirmation links land here with a one-time code (PKCE). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    log.warn("auth.callback_failed", { code: error.code ?? error.name });
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
