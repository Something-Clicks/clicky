import { classFromKinds, type EvidenceClass } from "@/lib/evidence";

import { runChecks, type BusinessContext, type Evidence, type Finding } from "../../checks";
import { rankNeeds, type RankedNeed } from "../rank";
import type { CapabilityModule } from "./types";
import type { WebsiteIntelligence } from "./website-intelligence";

/**
 * Marketing Analysis (§6): turns what Website Intelligence retrieved into findings, each with the
 * evidence behind it, a category, and an evidence class (§6.3), then ranks them (§7.2).
 * Today the findings come from fixed checks. Model-assisted findings on messaging and conversion
 * (origin "model") are added by a later step and must follow the same evidence rules.
 */
export type FindingCategory = "seo" | "technical" | "conversion" | "content" | "local";

export interface ClassifiedFinding extends Finding {
  category: FindingCategory;
  evidence_class: EvidenceClass;
}

export interface MarketingAnalysis {
  evidence: Evidence[];
  findings: ClassifiedFinding[];
  ranked: RankedNeed[];
}

const CATEGORY_BY_PREFIX: [RegExp, FindingCategory][] = [
  [/^meta\./, "seo"],
  [/^(site|mobile|pagespeed)\./, "technical"],
  [/^contact\./, "conversion"],
  [/^content\./, "content"],
  [/^local\./, "local"],
];

export const findingCategory = (checkKey: string): FindingCategory =>
  CATEGORY_BY_PREFIX.find(([re]) => re.test(checkKey))?.[1] ?? "content";

export function classifyFindings(findings: Finding[], evidence: Pick<Evidence, "key" | "kind">[]): ClassifiedFinding[] {
  const kindOf = new Map(evidence.map((e) => [e.key, e.kind]));
  return findings.map((f) => ({
    ...f,
    category: findingCategory(f.check_key),
    evidence_class: classFromKinds(f.evidence_keys.map((k) => kindOf.get(k) ?? "missing")),
  }));
}

export const marketingAnalysis: CapabilityModule<{ site: WebsiteIntelligence; business: BusinessContext }, MarketingAnalysis> = {
  id: "marketing_analysis",
  async run({ site, business }) {
    const { evidence, findings } = runChecks(site.scan, site.psi, business);
    const classified = classifyFindings(findings, evidence);
    const ranked = rankNeeds(classified, evidence);
    return {
      status: "done",
      output: { evidence, findings: classified, ranked },
      detail: ranked.length ? `${ranked.length} finding${ranked.length === 1 ? "" : "s"} from ${evidence.length} pieces of evidence; first: ${ranked[0]!.title}.` : `Nothing needs attention (${evidence.length} pieces of evidence).`,
    };
  },
};
