import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

/**
 * Website and ZIP from the homepage, carried through sign-up and business setup when
 * the free first result is switched off (or the visitor chooses to sign up first).
 * Short-lived, HTTP-only, same-site cookie; never placed in a URL.
 */
const COOKIE = "sc_start";
const StartSchema = z.object({
  website: z.string().max(300),
  zipCode: z.string().regex(/^[0-9]{5}$/),
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
