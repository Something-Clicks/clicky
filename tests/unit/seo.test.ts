import { describe, expect, it } from "vitest";

import { NOINDEX, PAGE_SEO, pageMetadata, SITE_URL, type PublicPath } from "@/config/seo";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

const pages = Object.entries(PAGE_SEO) as [PublicPath, (typeof PAGE_SEO)[PublicPath]][];

describe("page metadata", () => {
  it("every title and description is unique", () => {
    expect(new Set(pages.map(([, p]) => p.title)).size).toBe(pages.length);
    expect(new Set(pages.map(([, p]) => p.description)).size).toBe(pages.length);
  });

  it("titles are concise and carry the brand; descriptions are readable", () => {
    for (const [path, p] of pages) {
      expect(p.title.length, path).toBeLessThanOrEqual(65);
      expect(p.title, path).toMatch(/Something Clicks/);
      expect(p.description.length, path).toBeGreaterThanOrEqual(110);
      expect(p.description.length, path).toBeLessThanOrEqual(200);
    }
  });

  it("makes no claims the product can't back up", () => {
    // No AI wording until AI features are live (owner decision), and no ranking or result promises.
    const claims = /\b(AI|artificial intelligence|automat\w*|guarantee\w*|rank(ing)? (first|higher|#1)|#1|double|triple)\b|\d+\s?%/i;
    for (const [path, p] of pages) {
      expect(p.title, path).not.toMatch(claims);
      expect(p.description, path).not.toMatch(claims);
    }
  });

  it("builds canonical, Open Graph and Twitter metadata on the production domain", () => {
    const m = pageMetadata("/pricing");
    expect(m.title).toEqual({ absolute: PAGE_SEO["/pricing"].title });
    expect(m.alternates?.canonical).toBe("/pricing");
    expect(m.openGraph).toMatchObject({ url: "/pricing", title: PAGE_SEO["/pricing"].title, siteName: "Something Clicks" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
    expect(SITE_URL).toBe("https://somethingclicks.com");
    expect(NOINDEX).toEqual({ index: false, follow: false });
  });
});

describe("sitemap and robots", () => {
  it("lists exactly the indexable public pages on the production domain", () => {
    expect(sitemap().map((e) => e.url)).toEqual([
      "https://somethingclicks.com/",
      "https://somethingclicks.com/how-it-works",
      "https://somethingclicks.com/pricing",
      "https://somethingclicks.com/about",
      "https://somethingclicks.com/faq",
    ]);
  });

  it("robots lists the sitemap and keeps private areas out without blocking /apple-icon.png", () => {
    delete process.env.VERCEL_ENV;
    const r = robots();
    expect(r.sitemap).toBe("https://somethingclicks.com/sitemap.xml");
    const rules = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    const disallow = [rules.disallow].flat() as string[];
    expect(disallow).toEqual(expect.arrayContaining(["/app/", "/admin", "/api/"]));
    expect(disallow.some((d) => "/apple-icon.png".startsWith(d))).toBe(false);
  });

  it("preview deployments ask crawlers to stay out", () => {
    process.env.VERCEL_ENV = "preview";
    try {
      expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    } finally {
      delete process.env.VERCEL_ENV;
    }
  });
});
