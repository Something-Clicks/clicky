import { classFromKinds } from "@/lib/evidence";

import type { Evidence, Finding, Level } from "../checks";

/**
 * Ranks marketing needs from existing findings. Deterministic: no model, no invented numbers.
 *
 * Order: business impact, then evidence strength, then confidence, then lower effort
 * (a change the owner can make on the site before a larger piece of work). The original
 * order breaks ties, so the result is stable.
 *
 * Evidence classes follow spec 6.3:
 *   verified  - directly observed on the site or measured by a named tool
 *   estimated - an estimate with stated assumptions (none produced today)
 *   unknown   - the data needed was missing
 * ("inferred" needs a model and is never produced by checks.)
 */
export type EvidenceClass = "verified" | "estimated" | "unknown";

export interface RankedNeed {
  rank: number;
  check_key: string;
  title: string;
  impact: Level;
  confidence: Level;
  evidence: EvidenceClass;
  /** Why this one is where it is, in plain words. */
  why_ranked: string;
  /** True when the work is a change on the website the owner (or their designer) makes. */
  owner_change: boolean;
}

const LEVEL: Record<Level, number> = { high: 0, medium: 1, low: 2 };
const EVIDENCE: Record<EvidenceClass, number> = { verified: 0, estimated: 1, unknown: 2 };

/** Class from the cited evidence (shared rule in src/lib/evidence.ts). Checks never produce "inferred". */
export function evidenceClass(finding: Pick<Finding, "evidence_keys">, evidence: Pick<Evidence, "key" | "kind">[]): EvidenceClass {
  const byKey = new Map(evidence.map((e) => [e.key, e.kind]));
  return classFromKinds(finding.evidence_keys.map((k) => byKey.get(k) ?? "missing")) as EvidenceClass;
}

export function rankNeeds(findings: Finding[], evidence: Pick<Evidence, "key" | "kind">[]): RankedNeed[] {
  return findings
    .map((f, i) => ({ f, i, ev: evidenceClass(f, evidence) }))
    .sort(
      (a, b) =>
        LEVEL[a.f.impact_priority] - LEVEL[b.f.impact_priority] ||
        EVIDENCE[a.ev] - EVIDENCE[b.ev] ||
        LEVEL[a.f.confidence] - LEVEL[b.f.confidence] ||
        Number(a.f.execution_type !== "manual") - Number(b.f.execution_type !== "manual") ||
        a.i - b.i,
    )
    .map(({ f, ev }, i) => ({
      rank: i + 1,
      check_key: f.check_key,
      title: f.title,
      impact: f.impact_priority,
      confidence: f.confidence,
      evidence: ev,
      why_ranked: `${f.impact_priority[0]!.toUpperCase()}${f.impact_priority.slice(1)} impact; ${ev === "verified" ? "seen directly on your website or measured" : ev === "estimated" ? "based on an estimate" : "some information was missing"}; ${f.confidence} confidence.`,
      owner_change: f.execution_type === "manual",
    }));
}
