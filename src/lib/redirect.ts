/**
 * Returns a same-site path to send the user to after sign-in, or the fallback.
 * Rejects absolute URLs, protocol-relative URLs, backslashes and control
 * characters so a link like /login?next=//evil.example cannot redirect off-site.
 */
export function safeNextPath(next: unknown, fallback = "/app"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 300) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  for (let i = 0; i < next.length; i++) if (next.charCodeAt(i) < 0x20) return fallback;
  return next;
}

/** Paths that need a signed-in user. */
export const isProtectedPath = (pathname: string) =>
  pathname === "/app" ||
  pathname.startsWith("/app/") ||
  pathname === "/admin" ||
  pathname.startsWith("/admin/");
