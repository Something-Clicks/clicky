import type { MetadataRoute } from "next";

import { SITE_URL } from "@/config/seo";

/**
 * /robots.txt. Preview and development deployments on Vercel ask crawlers to stay out entirely
 * (they sit behind Deployment Protection anyway). Everywhere else, including Production, private
 * areas are disallowed and the production sitemap is listed.
 */
export default function robots(): MetadataRoute.Robots {
  const env = process.env.VERCEL_ENV;
  if (env === "preview" || env === "development") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", // "/app/" and "/app$" rather than "/app", which would also block /apple-icon.png.
    disallow: ["/app$", "/app/", "/admin", "/auth/", "/api/", "/claim$", "/claim?"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
