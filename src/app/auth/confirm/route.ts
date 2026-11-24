import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { log } from "@/lib/log";
import { nextPath } from "@/lib/email-links";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "recovery", "invite", "email_change"];

/**
 * Email links land here. With the token_hash email templates (docs/launch/INTEGRATIONS.md)
 * the link works in ANY browser: the token is verified on the server, no browser-held
 * secret is needed. A ?code= link (default templates, same browser only) also works.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = nextPath(searchParams.get("next"), origin);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const supabase = await createClient();

  if (tokenHash && type && TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(type === "recovery" ? "/reset-password" : next, origin));
    log.warn("auth.confirm_failed", { code: error.code ?? error.name, type });
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    log.warn("auth.confirm_code_failed", { code: error.code ?? error.name });
  }
  return NextResponse.redirect(new URL("/login?error=link", origin));
}
