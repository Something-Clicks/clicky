/**
 * Builds the source packet for one site, once, with the app's own code: the safe fetcher (SSRF
 * defenses, size and redirect limits), the page scan, PageSpeed when available, and the fixed checks.
 * The packet is saved to disk and every provider receives exactly the same packet.
 */
import { runChecks, type Evidence, type Finding } from "@/lib/server/checks";
import { runPageSpeed } from "@/lib/server/pagespeed";
import { createSafeFetcher } from "@/lib/server/safe-fetch";
import { scanSite } from "@/lib/server/site-scan";

export interface SiteInput {
  url: string;
  business_name: string;
  service_area: string | null;
  primary_goal: string | null;
}

export interface PagePacket {
  key: string;
  url: string;
  title: string | null;
  meta_description: string | null;
  h1s: string[];
  headings: string[];
  text: string;
}

export interface SourcePacket {
  site: SiteInput;
  built_at: string;
  pages: PagePacket[];
  unreachable: { url: string; reason: string }[];
  evidence: Pick<Evidence, "key" | "kind" | "source" | "check_key" | "url" | "observation" | "excerpt">[];
  checks: Pick<Finding, "check_key" | "title" | "explanation" | "impact_priority" | "evidence_keys">[];
  pagespeed: "measured" | "missing";
}

/** Page text is cut to keep the packet the same, bounded size for every provider. */
const TEXT_LIMIT = { home: 6000, other: 2500 };

export async function buildPacket(site: SiteInput): Promise<SourcePacket> {
  const fetchPage = createSafeFetcher();
  const [scan, psi] = await Promise.all([scanSite(site.url, fetchPage), runPageSpeed(site.url)]);
  const { evidence, findings } = runChecks(scan, psi, {
    businessName: site.business_name,
    serviceArea: site.service_area,
    primaryGoal: site.primary_goal,
  });
  const pages = [scan.homepage, ...scan.pages].map((p, i) => ({
    key: `page${i}`,
    url: p.url,
    title: p.title,
    meta_description: p.metaDescription,
    h1s: p.h1s,
    headings: p.headings,
    text: p.text.slice(0, i === 0 ? TEXT_LIMIT.home : TEXT_LIMIT.other),
  }));
  return {
    site,
    built_at: new Date().toISOString(),
    pages,
    unreachable: scan.failures,
    evidence: evidence.map(({ key, kind, source, check_key, url, observation, excerpt }) => ({ key, kind, source, check_key, url, observation, excerpt })),
    checks: findings.map(({ check_key, title, explanation, impact_priority, evidence_keys }) => ({ check_key, title, explanation, impact_priority, evidence_keys })),
    pagespeed: psi.ok ? "measured" : "missing",
  };
}

/** Every key a model may cite: evidence keys and page keys. */
export const citableKeys = (p: SourcePacket) => new Set([...p.evidence.map((e) => e.key), ...p.pages.map((pg) => pg.key)]);

/** Keys that point at directly observed or measured material (pages count as observed). */
export const observedKeys = (p: SourcePacket) =>
  new Set([...p.evidence.filter((e) => e.kind === "observed" || e.kind === "measured").map((e) => e.key), ...p.pages.map((pg) => pg.key)]);

/** All source text, for checking whether a figure in a draft came from the business's own material. */
export const sourceText = (p: SourcePacket) =>
  [p.site.business_name, p.site.service_area ?? "", ...p.pages.flatMap((pg) => [pg.title ?? "", pg.meta_description ?? "", ...pg.h1s, ...pg.headings, pg.text]), ...p.evidence.map((e) => `${e.observation} ${e.excerpt ?? ""}`)].join("\n");

/** The user message for a task. Identical across providers; website content is fenced as data. */
export function userMessage(task: string, p: SourcePacket, prior: { profile?: unknown; findings?: unknown }): string {
  const parts = [
    `<profile>${JSON.stringify({ business_name: p.site.business_name, website: p.site.url, service_area: p.site.service_area, main_goal: p.site.primary_goal })}</profile>`,
    `<evidence>${JSON.stringify(p.evidence)}</evidence>`,
    `<pages>\n${p.pages.map((pg) => `<website_content key="${pg.key}" url="${pg.url}">${JSON.stringify(pg)}</website_content>`).join("\n")}\n</pages>`,
  ];
  if (p.unreachable.length) parts.push(`<unreachable>${JSON.stringify(p.unreachable)}</unreachable>`);
  if (task === "findings") parts.push(`<checks>${JSON.stringify(p.checks)}</checks>`);
  if (task === "drafts") {
    parts.push(`<profile_summary>${JSON.stringify(prior.profile ?? null)}</profile_summary>`);
    parts.push(`<findings>${JSON.stringify(prior.findings ?? null)}</findings>`);
  }
  return parts.join("\n");
}
