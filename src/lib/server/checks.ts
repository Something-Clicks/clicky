import type { PageSpeedMissing, PageSpeedResult } from "./pagespeed";
import type { PageFacts, SiteScan } from "./site-scan";

/**
 * Deterministic checks. Each records evidence (what was observed or measured, with
 * the page it came from) and, when something needs attention, a finding with
 * plain-language template wording. Every finding cites its evidence keys.
 * Nothing here estimates traffic, rankings, calls or revenue.
 */

export type Source = "website" | "pagespeed" | "search_console" | "google_business_profile";
export type Kind = "observed" | "measured" | "estimated" | "missing";
export type Level = "high" | "medium" | "low";
export type ExecutionType = "page_copy" | "meta" | "gbp_post" | "review_reply" | "blog_draft" | "manual";

export interface Evidence {
  key: string;
  source: Source;
  kind: Kind;
  check_key: string;
  url: string | null;
  observation: string;
  excerpt: string | null;
  measurement: Record<string, unknown> | null;
}

export interface Finding {
  check_key: string;
  title: string;
  explanation: string;
  why_it_matters: string;
  recommended_action: string;
  expected_benefit: string;
  impact_priority: Level;
  confidence: Level;
  ai_capable: boolean;
  execution_type: ExecutionType;
  approval_required: boolean;
  evidence_keys: string[];
}

export interface BusinessContext {
  businessName: string;
  serviceArea: string | null;
  primaryGoal: string | null;
}

const LEVEL_RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 };
const short = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pathOf = (url: string) => {
  const p = new URL(url).pathname;
  return p === "/" ? "your homepage" : `the ${p} page`;
};

export function runChecks(scan: SiteScan, psi: PageSpeedResult | PageSpeedMissing, biz: BusinessContext) {
  const evidence: Evidence[] = [];
  const findings: Finding[] = [];
  let n = 0;
  const ev = (e: Omit<Evidence, "key">) => {
    const key = `e${++n}`;
    evidence.push({ key, ...e });
    return key;
  };
  const home = scan.homepage;
  const all: PageFacts[] = [home, ...scan.pages];

  // Pages reviewed
  for (const p of all) {
    ev({
      source: "website", kind: "observed", check_key: "site.page_reviewed", url: p.url,
      observation: `Reviewed ${pathOf(p.url)}: ${p.wordCount} words${p.truncated ? " (page was very large; the first part was reviewed)" : ""}.`,
      excerpt: p.title ? `Title: ${short(p.title, 200)}` : null, measurement: { words: p.wordCount },
    });
  }
  for (const f of scan.failures) {
    ev({ source: "website", kind: "missing", check_key: "site.page_unreachable", url: f.url, observation: `Could not review this page: ${short(f.reason, 200)}`, excerpt: null, measurement: null });
  }

  // HTTPS
  if (new URL(home.url).protocol !== "https:") {
    const k = ev({ source: "website", kind: "observed", check_key: "site.no_https", url: home.url, observation: "Your homepage loads without a secure (https) connection.", excerpt: null, measurement: null });
    findings.push({
      check_key: "site.no_https", title: "Turn on a secure connection for your website",
      explanation: "Your website opens with http:// instead of https://.",
      why_it_matters: "Browsers mark sites without https as “Not secure”, which can make visitors leave before they contact you.",
      recommended_action: "Ask your website host to turn on a free SSL certificate and send all visitors to the https:// address.",
      expected_benefit: "Visitors stop seeing a “Not secure” warning on your site.",
      impact_priority: "high", confidence: "high", ai_capable: false, execution_type: "manual", approval_required: false, evidence_keys: [k],
    });
  }

  // Title
  if (!home.title) {
    const k = ev({ source: "website", kind: "observed", check_key: "meta.title_missing", url: home.url, observation: "Your homepage has no page title.", excerpt: null, measurement: null });
    findings.push({
      check_key: "meta.title_missing", title: "Add a page title to your homepage",
      explanation: "Your homepage does not have a page title, the line search engines show as the headline of your listing.",
      why_it_matters: "Without a title, search results guess what to show, and people may not see what you do or where.",
      recommended_action: `Write a title of about 50–60 characters that names your main service${biz.serviceArea ? ` and ${biz.serviceArea}` : ""}, followed by ${biz.businessName}.`,
      expected_benefit: "People searching can tell what your page offers before they click.",
      impact_priority: "high", confidence: "high", ai_capable: true, execution_type: "meta", approval_required: true, evidence_keys: [k],
    });
  } else {
    const len = home.title.length;
    const k = ev({ source: "website", kind: "observed", check_key: "meta.title", url: home.url, observation: `Your homepage title is ${len} characters long.`, excerpt: short(home.title, 200), measurement: { length: len } });
    if (len < 20 || len > 65) {
      findings.push({
        check_key: "meta.title_length", title: len < 20 ? "Make your homepage title more descriptive" : "Shorten your homepage title",
        explanation: len < 20 ? `Your homepage title, “${short(home.title, 80)}”, is very short.` : `Your homepage title is ${len} characters, so search results will likely cut it off.`,
        why_it_matters: "The title is the first thing people read in search results. A clear one helps them choose you.",
        recommended_action: `Rewrite it to about 50–60 characters: your main service${biz.serviceArea ? `, ${biz.serviceArea}` : ""}, and ${biz.businessName}.`,
        expected_benefit: "A clearer headline for your business in search results.",
        impact_priority: "medium", confidence: "high", ai_capable: true, execution_type: "meta", approval_required: true, evidence_keys: [k],
      });
    }
  }

  // Meta description
  if (!home.metaDescription) {
    const k = ev({ source: "website", kind: "observed", check_key: "meta.description_missing", url: home.url, observation: "Your homepage has no meta description.", excerpt: null, measurement: null });
    findings.push({
      check_key: "meta.description_missing", title: "Add a short description for search results",
      explanation: "Your homepage has no meta description, the short summary search engines may show under your title.",
      why_it_matters: "Without one, search engines pick random text from the page, which may not explain why someone should choose you.",
      recommended_action: "Write one or two sentences (about 150 characters) that say what you offer, who it's for, and how to get in touch.",
      expected_benefit: "A summary in search results that you chose, instead of a random sentence.",
      impact_priority: "medium", confidence: "high", ai_capable: true, execution_type: "meta", approval_required: true, evidence_keys: [k],
    });
  } else {
    ev({ source: "website", kind: "observed", check_key: "meta.description", url: home.url, observation: `Your homepage has a meta description (${home.metaDescription.length} characters).`, excerpt: short(home.metaDescription, 300), measurement: { length: home.metaDescription.length } });
  }

  // H1
  if (home.h1s.length === 0) {
    const k = ev({ source: "website", kind: "observed", check_key: "content.h1_missing", url: home.url, observation: "Your homepage has no main heading (H1).", excerpt: null, measurement: { h1: 0 } });
    findings.push({
      check_key: "content.h1_missing", title: "Give your homepage a clear main headline",
      explanation: "Your homepage has no main heading that says what you do.",
      why_it_matters: "Visitors decide in seconds whether you can help them. A clear headline answers that right away.",
      recommended_action: `Add a headline at the top that names your main service${biz.serviceArea ? ` and that you serve ${biz.serviceArea}` : ""}.`,
      expected_benefit: "Visitors understand what you offer as soon as the page opens.",
      impact_priority: "high", confidence: "high", ai_capable: true, execution_type: "page_copy", approval_required: true, evidence_keys: [k],
    });
  } else {
    ev({ source: "website", kind: "observed", check_key: "content.h1", url: home.url, observation: `Your homepage's main heading: “${short(home.h1s[0]!, 150)}”.`, excerpt: null, measurement: { h1: home.h1s.length } });
  }

  // Click-to-call
  const anyTel = all.some((p) => p.telLinks.length > 0);
  const phoneShown = all.find((p) => p.phoneInText)?.phoneInText ?? null;
  if (!home.telLinks.length) {
    const k = ev({
      source: "website", kind: "observed", check_key: "contact.no_click_to_call", url: home.url,
      observation: phoneShown ? `A phone number appears on your site (${phoneShown}) but it can't be tapped to call from your homepage.` : "No tap-to-call phone number was found on your homepage.",
      excerpt: null, measurement: { telLinksOnHomepage: 0, telLinksOnSite: anyTel },
    });
    findings.push({
      check_key: "contact.no_click_to_call", title: "Let phone visitors call you with one tap",
      explanation: phoneShown ? "Your phone number is shown as plain text, so people on phones have to copy it to call." : "Your homepage doesn't have a phone number people can tap to call.",
      why_it_matters: "Most local visitors browse on phones. Making it easy to call removes a step between interest and a conversation.",
      recommended_action: "Add your phone number near the top of the homepage as a tap-to-call link (a “tel:” link), and repeat it near the bottom.",
      expected_benefit: "Fewer steps for a visitor who wants to call you.",
      impact_priority: biz.primaryGoal === "more_calls" ? "high" : "medium", confidence: "high", ai_capable: false, execution_type: "manual", approval_required: false, evidence_keys: [k],
    });
  } else {
    ev({ source: "website", kind: "observed", check_key: "contact.click_to_call", url: home.url, observation: "Your homepage has a tap-to-call phone link.", excerpt: short(home.telLinks[0]!, 60), measurement: null });
  }

  // Service area
  if (biz.serviceArea) {
    const area = biz.serviceArea.split(/[,/]| and /i)[0]!.trim();
    const found = area.length >= 3 && home.text.toLowerCase().includes(area.toLowerCase());
    const k = ev({
      source: "website", kind: "observed", check_key: found ? "local.service_area" : "local.service_area_missing", url: home.url,
      observation: found ? `Your homepage mentions “${area}”.` : `Your homepage text does not mention “${area}”, the area you told us you serve.`,
      excerpt: null, measurement: { searched_for: area, found },
    });
    if (!found) {
      findings.push({
        check_key: "local.service_area_missing", title: "Say where you work on your homepage",
        explanation: `Your homepage doesn't mention ${area}, where you told us you serve customers.`,
        why_it_matters: "Nearby customers look for proof that you serve their area. Search engines also use it to match you with local searches.",
        recommended_action: `Mention ${biz.serviceArea} near the top of your homepage, for example in the headline or the sentence below it.`,
        expected_benefit: "Local visitors can see right away that you serve them.",
        impact_priority: biz.primaryGoal === "get_found" ? "high" : "medium", confidence: "medium", ai_capable: true, execution_type: "page_copy", approval_required: true, evidence_keys: [k],
      });
    }
  }

  // Mobile viewport
  if (!home.hasViewport) {
    const k = ev({ source: "website", kind: "observed", check_key: "mobile.viewport_missing", url: home.url, observation: "Your homepage is missing the mobile viewport setting.", excerpt: null, measurement: null });
    findings.push({
      check_key: "mobile.viewport_missing", title: "Make your homepage fit phone screens",
      explanation: "Your homepage is missing the setting that tells phones to size the page to the screen.",
      why_it_matters: "Without it, phones show a shrunken desktop page that is hard to read and tap.",
      recommended_action: "Ask your web designer to add the standard mobile viewport tag, or switch to a mobile-friendly theme.",
      expected_benefit: "Phone visitors can read and tap your page without zooming.",
      impact_priority: "high", confidence: "high", ai_capable: false, execution_type: "manual", approval_required: false, evidence_keys: [k],
    });
  }

  // Thin homepage
  if (home.wordCount < 150) {
    const k = ev({ source: "website", kind: "observed", check_key: "content.thin_homepage", url: home.url, observation: `Your homepage has about ${home.wordCount} words of text.`, excerpt: null, measurement: { words: home.wordCount } });
    findings.push({
      check_key: "content.thin_homepage", title: "Explain your services in a few more words",
      explanation: `Your homepage has about ${home.wordCount} words, which may not be enough to explain what you offer.`,
      why_it_matters: "Visitors and search engines both need a few clear sentences to understand your services and who they are for.",
      recommended_action: "Add a short section that lists your main services, who they help, and where you work.",
      expected_benefit: "Visitors get enough information to decide to contact you.",
      impact_priority: "medium", confidence: "medium", ai_capable: true, execution_type: "page_copy", approval_required: true, evidence_keys: [k],
    });
  }

  // Images without descriptions
  const missingAlt = all.reduce((s, p) => s + p.imagesMissingAlt, 0);
  const totalImg = all.reduce((s, p) => s + p.imagesTotal, 0);
  if (missingAlt > 0) {
    const k = ev({ source: "website", kind: "observed", check_key: "a11y.images_missing_alt", url: home.url, observation: `${missingAlt} of ${totalImg} images on the pages reviewed have no text description (alt text).`, excerpt: null, measurement: { missing: missingAlt, total: totalImg } });
    findings.push({
      check_key: "a11y.images_missing_alt", title: "Describe your images",
      explanation: `${missingAlt} images on your site have no text description.`,
      why_it_matters: "Descriptions help people using screen readers and help search engines understand your photos.",
      recommended_action: "Add a short description to each image that shows your work, team or location.",
      expected_benefit: "Your site is easier to use for more people.",
      impact_priority: "low", confidence: "high", ai_capable: false, execution_type: "manual", approval_required: false, evidence_keys: [k],
    });
  }

  // PageSpeed
  if (psi.ok) {
    const k = ev({
      source: "pagespeed", kind: "measured", check_key: "pagespeed.performance", url: psi.url,
      observation: `Google PageSpeed Insights scored your homepage ${psi.performanceScore}/100 for performance on mobile.${psi.lcpMs ? ` The main content took about ${(psi.lcpMs / 1000).toFixed(1)} seconds to appear.` : ""}`,
      excerpt: null, measurement: { score: psi.performanceScore, lcp_ms: psi.lcpMs, cls: psi.cls, tbt_ms: psi.tbtMs },
    });
    if (psi.performanceScore < 90) {
      const slow = psi.performanceScore < 50;
      findings.push({
        check_key: "pagespeed.performance", title: slow ? "Speed up your homepage on phones" : "Make your homepage a little faster on phones",
        explanation: `Google measured your homepage at ${psi.performanceScore}/100 for mobile performance.`,
        why_it_matters: "Slow pages lose visitors, especially on phones. Every second of waiting is a chance for someone to go back to the search results.",
        recommended_action: "Ask your web designer to compress large images, remove unused plugins or scripts, and turn on caching. Then run the analysis again to check.",
        expected_benefit: "Pages that open faster for phone visitors.",
        impact_priority: slow ? "high" : "medium", confidence: "high", ai_capable: false, execution_type: "manual", approval_required: false, evidence_keys: [k],
      });
    }
  } else {
    ev({ source: "pagespeed", kind: "missing", check_key: "pagespeed.unavailable", url: home.url, observation: psi.reason, excerpt: null, measurement: null });
  }

  findings.sort((a, b) => LEVEL_RANK[a.impact_priority] - LEVEL_RANK[b.impact_priority] || LEVEL_RANK[a.confidence] - LEVEL_RANK[b.confidence]);
  return { evidence, findings };
}
