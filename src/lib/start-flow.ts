import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

/**
 * Details from the Diagnostic Audit form, carried through sign-up and business setup
 * so the visitor doesn't type them twice. Short-lived, HTTP-only, same-site cookie;
 * never placed in a URL.
 */
const COOKIE = "sc_start";
const StartSchema = z.object({
  businessName: z.string().max(160),
  website: z.string().max(300),
  primaryGoal: z.string().max(40),
  email: z.string().max(254),
  plan: z.literal("diagnostic_audit"),
});
export type StartFlow = z.infer<typeof StartSchema>;

export async function setStartFlow(value: StartFlow) {
  (await cookies()).set(COOKIE, JSON.stringify(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24,
    path: "/",
  });
}

export async function getStartFlow(): Promise<StartFlow | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = StartSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function clearStartFlow() {
  (await cookies()).delete(COOKIE);
}
