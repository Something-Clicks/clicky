import type { MetadataRoute } from "next";

import { PAGE_SEO, SITE_URL, type PublicPath } from "@/config/seo";

/**
 * /sitemap.xml: the indexable public pages only, always on the production domain.
 * Excluded on purpose: /app and /admin (signed in), /login, /signup, password pages, /start and
 * /claim-problem (private results and links), /privacy and /terms (drafts, noindex until approved),
 * /diagnostic-audit (redirects to /pricing), and every API route.
 * No lastModified: we don't track real content dates, and a made-up date is worse than none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return (Object.keys(PAGE_SEO) as PublicPath[]).map((path) => ({ url: path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}` }));
}
