import type { Metadata } from "next";

/**
 * Search and sharing metadata for public pages: titles, descriptions, canonical URLs,
 * Open Graph and Twitter cards. Change page metadata here and nowhere else.
 *
 * Owner decision (Nov 24 2026): no "AI" wording until AI features are live and the Privacy Policy says so.
 * Then the homepage title becomes "AI Marketing Platform for Small Businesses | Something Clicks".
 *
 * Rules: describe what the page and the product actually do today; titles name the product
 * or the page's subject and category, never a slogan; no ranking, traffic or revenue claims;
 * every title and description is unique (checked by tests/unit/seo.test.ts).
 */

/** The canonical production domain. Canonical URLs, the sitemap and social cards always use it. */
export const SITE_URL = "https://somethingclicks.com";
export const SITE_NAME = "Something Clicks";

export type PublicPath = "/" | "/how-it-works" | "/pricing" | "/about" | "/faq";

interface PageSeo {
  /** Full title as it appears in search results (no template is applied). */
  title: string;
  description: string;
  /** What someone searching would be looking for. Documentation only. */
  intent: string;
}

/** Indexable public pages. Only these go in the sitemap. */
export const PAGE_SEO: Record<PublicPath, PageSeo> = {
  "/": {
    title: "Marketing Platform for Small Businesses | Something Clicks",
    description:
      "Check your website free and get a ranked list of marketing fixes, each with the evidence behind it. Something Clicks helps small businesses understand their marketing and take action.",
    intent: "Small business owners looking for a marketing platform or tool that shows what to improve on their website.",
  },
  "/how-it-works": {
    title: "How the Website Marketing Check Works | Something Clicks",
    description:
      "Enter your website, see a ranked list of what's worth fixing with the evidence for each item, make the fix, then check again to see what improved.",
    intent: "Prospects who want to understand the process before trying it.",
  },
  "/pricing": {
    title: "Pricing for Small Business Marketing Plans | Something Clicks",
    description:
      "Start with three free uses. Marketing Report is $49 one-time; Marketing Assistant is $79 a month or $756 a year. No retainers, cancel any time.",
    intent: "Prospects comparing the cost of small business marketing software.",
  },
  "/about": {
    title: "About Something Clicks | Marketing Help for Small Businesses",
    description:
      "Something Clicks is a Salt Lake City company that looks at small business websites and explains what's worth fixing, in plain words, with evidence and next steps.",
    intent: "People checking who is behind Something Clicks (brand and trust).",
  },
  "/faq": {
    title: "FAQ: Website Checks, Pricing and Your Data | Something Clicks",
    description:
      "Answers about Something Clicks: which pages we check, what you get, free uses, pricing, what no one can promise, and how your data stays private.",
    intent: "Prospects with specific questions about scope, cost and data.",
  },
};

/** Pages that are public but must not be indexed (auth, results, drafts, link problems). */
export const NOINDEX: Metadata["robots"] = { index: false, follow: false };

/** The social card built by src/app/opengraph-image.tsx. Set explicitly: a page's own openGraph replaces the inherited one. */
const SHARE_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Something Clicks: marketing help for small businesses" };

/** Default description for pages without their own (noindex pages only), so no indexable page shares one. */
export const DEFAULT_DESCRIPTION = "Something Clicks: website marketing checks for small businesses.";

/** Complete metadata for one indexable public page. */
export function pageMetadata(path: PublicPath): Metadata {
  const { title, description } = PAGE_SEO[path];
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: path, title, description, images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [SHARE_IMAGE.url] },
  };
}

/** Structured data for the homepage: the organization and the website. Facts only. */
export const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Something Clicks LLC",
      alternateName: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon.png`,
      address: { "@type": "PostalAddress", addressLocality: "Salt Lake City", addressRegion: "UT", addressCountry: "US" },
    },
    { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: SITE_NAME, url: SITE_URL, publisher: { "@id": `${SITE_URL}/#organization` } },
  ],
};
