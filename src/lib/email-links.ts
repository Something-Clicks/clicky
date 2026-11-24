import { safeNextPath } from "@/lib/redirect";

/**
 * Where an email link should go after /auth/confirm. `raw` may be a full URL from the
 * email template's {{ .RedirectTo }}; only same-site paths are followed.
 */
export function nextPath(raw: string | null, origin: string, depth = 0): string {
  let path: string;
  if (raw && /^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const allowed = [origin, process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "")].filter(Boolean);
      if (!allowed.includes(u.origin)) return "/app";
      path = safeNextPath(`${u.pathname}${u.search}`);
    } catch {
      return "/app";
    }
  } else {
    path = safeNextPath(raw);
  }
  // Our own redirect URLs point at /auth/confirm?next=…; unwrap them.
  if (path.startsWith("/auth/confirm") && depth < 2) {
    return nextPath(new URL(path, origin).searchParams.get("next"), origin, depth + 1);
  }
  return path;
}

/** The emailRedirectTo for every email link: lands on this route, then goes to `path`. */
export function confirmUrl(siteOrigin: string, path: string) {
  return `${siteOrigin}/auth/confirm?next=${encodeURIComponent(path)}`;
}

