/**
 * Runs the deterministic Marketing Agent (no model, no database) on one website and reports what it found:
 * scan, findings with evidence class and confidence, ranked needs, business details with source and quotes, what is
 * missing, and the rules-based plan. Used by the fixture tests (known ground truth) and by `pnpm sitecheck` (real sites
 * the owner has permission to scan, run from a machine with internet access).
 */
import type { ProposedFact, StoredFact } from "@/lib/business-profile";
import { analyzeWebsite, type AnalysisDeps } from "@/lib/server/analysis";
import { propose, understand } from "@/lib/server/agent/modules/business-intelligence";
import type { StoredPlan } from "@/lib/server/agent/modules/marketing-strategy";
import { buildRulesPlan } from "@/lib/server/agent/modules/rules-strategy";
import type { SiteScan } from "@/lib/server/site-scan";

export interface SiteReport {
  website: string;
  ok: boolean;
  reason?: string;
  pagesReviewed: number;
  pagesUnreachable: string[];
  findings: { id: string; check_key: string; title: string; impact: string; confidence: string; evidence_class: string; evidence: { kind: string; url: string | null; excerpt: string | null; observation: string }[] }[];
  facts: ProposedFact[];
  missing: string[];
  plan: StoredPlan | null;
  scan?: SiteScan;
}

export async function checkSite(website: string, biz: { businessName: string; serviceArea: string | null; primaryGoal: string | null }, deps: AnalysisDeps = {}): Promise<SiteReport> {
  let r;
  try {
    r = await analyzeWebsite(website, biz, deps);
  } catch (error) {
    return { website, ok: false, reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error), pagesReviewed: 0, pagesUnreachable: [], findings: [], facts: [], missing: [], plan: null };
  }
  const byKey = new Map(r.evidence.map((e) => [e.key, e]));
  const findings = r.findings.map((f, i) => ({
    id: `f${i + 1}`, check_key: f.check_key, title: f.title, impact: f.impact_priority, confidence: f.confidence, evidence_class: f.evidence_class,
    evidence: f.evidence_keys.map((k) => byKey.get(k)).filter(Boolean).map((e) => ({ kind: e!.kind, url: e!.url ?? null, excerpt: e!.excerpt ?? null, observation: e!.observation })),
  }));
  const facts = propose(r.scan);
  const stored: StoredFact[] = facts.map((f, i) => ({ ...f, id: `fact${i}`, status: "proposed", observed_at: new Date().toISOString(), confirmed_at: null, source: f.source }));
  const u = understand({ businessName: biz.businessName, website, serviceArea: biz.serviceArea, primaryGoal: biz.primaryGoal }, stored);
  const plan = buildRulesPlan({
    businessName: biz.businessName, primaryGoal: biz.primaryGoal, missing: u.missing,
    cards: r.findings.map((f, i) => ({ id: `f${i + 1}`, check_key: f.check_key, title: f.title, why_it_matters: f.why_it_matters, recommended_action: f.recommended_action, impact: f.impact_priority, confidence: f.confidence, evidence_class: f.evidence_class })),
  });
  return {
    website, ok: true, pagesReviewed: 1 + r.scan.pages.length, pagesUnreachable: r.scan.failures.map((f) => `${f.url} (${f.reason})`),
    findings, facts, missing: u.missing, plan, scan: r.scan,
  };
}

const CLAIM_FIELDS = new Set(["trust_signal", "competitive_advantage", "pricing"]);

/** A readable report for a person to check against the live site. Nothing here is a verdict. */
export function toMarkdown(reports: SiteReport[]): string {
  const out: string[] = ["# Site check report (deterministic agent, no model)", "", "Read each item against the live site. Mark every line: correct / wrong / missing.", ""];
  for (const r of reports) {
    out.push(`## ${r.website}`, "");
    if (!r.ok) { out.push(`**Could not check:** ${r.reason}`, ""); continue; }
    out.push(`Pages reviewed: ${r.pagesReviewed}${r.pagesUnreachable.length ? `; not reachable: ${r.pagesUnreachable.join(", ")}` : ""}`, "");
    out.push("### Business details (the agent only proposes)", "| Field | Value | Kind | Source quote | Page | Correct? |", "|---|---|---|---|---|---|");
    for (const f of r.facts) {
      const kind = f.source === "website" && CLAIM_FIELDS.has(f.field) ? "claim the site makes (not checked)" : f.evidence_class;
      const ev = f.evidence[0];
      out.push(`| ${f.field} | ${(f.value ?? "unknown").replace(/\|/g, "/")} | ${kind} | ${(ev?.excerpt ?? "").replace(/\|/g, "/")} | ${ev?.url ?? ""} | |`);
    }
    out.push("", `Not found on the site (unknown): ${r.missing.join(", ") || "nothing"}`, "");
    out.push("### Findings (fixed checks)", "| # | Impact | Confidence | Class | Title | Evidence | Real and visible? |", "|---|---|---|---|---|---|---|");
    for (const f of r.findings) out.push(`| ${f.id} | ${f.impact} | ${f.confidence} | ${f.evidence_class} | ${f.title} | ${f.evidence.map((e) => e.observation).join(" / ").replace(/\|/g, "/")} | |`);
    out.push("");
    if (r.plan) {
      out.push("### Plan (fixed rules)", r.plan.summary, "");
      r.plan.priorities.forEach((p) => out.push(`${p.order}. ${r.findings.find((f) => f.id === p.card_id)?.title ?? p.card_id} (${p.effort}): ${p.why_now}`));
      out.push("", `Questions: ${r.plan.questions.join(" / ") || "none"}`, "");
    }
  }
  return out.join("\n");
}
