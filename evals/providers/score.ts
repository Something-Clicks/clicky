/**
 * Measured, automatic checks on one provider's output for one site. Every check is mechanical and
 * identical across providers; nothing here judges writing quality (that is the blind human review).
 */
import { leaksSystemText } from "@/lib/server/text-guard";

import { citableKeys, observedKeys, sourceText, type SourcePacket } from "./material";
import type { BusinessProfile, Drafts, Findings } from "./tasks";

/** Promises and figures the product must never make up. */
const PROMISES = /\b(guarantee[ds]?|number one|best in (town|the city)|rank (first|higher|#)|award[- ]winning|double your|triple your)\b|(?<!\w)#1(?!\w)/i;

export interface Measured {
  citations_total: number;
  citations_invalid: number;
  /** "verified" claims with no citation, or citing only missing-data evidence. */
  verified_unsupported: number;
  /** inferred/estimated claims without a stated basis. */
  basis_missing: number;
  class_counts: Record<string, number>;
  findings: number;
  /** Numbers in drafts that do not appear anywhere in the source material (possible invention). */
  draft_numbers_not_in_source: string[];
  draft_promises: number;
  draft_system_leaks: number;
  seo_items: number;
  seo_title_in_range: number;
  seo_meta_in_range: number;
  headline_in_limit: boolean | null;
  business_name_used: boolean | null;
  placeholders: number;
}

interface ClaimLike {
  text?: string;
  evidence_class: string;
  evidence_keys: string[];
  basis?: string;
}

export function scoreWorkflow(p: SourcePacket, out: { profile: BusinessProfile | null; findings: Findings | null; drafts: Drafts | null }): Measured {
  const valid = citableKeys(p);
  const observed = observedKeys(p);
  const m: Measured = {
    citations_total: 0, citations_invalid: 0, verified_unsupported: 0, basis_missing: 0, class_counts: {}, findings: 0,
    draft_numbers_not_in_source: [], draft_promises: 0, draft_system_leaks: 0, seo_items: 0, seo_title_in_range: 0, seo_meta_in_range: 0,
    headline_in_limit: null, business_name_used: null, placeholders: 0,
  };
  const claim = (c: ClaimLike) => {
    m.class_counts[c.evidence_class] = (m.class_counts[c.evidence_class] ?? 0) + 1;
    m.citations_total += c.evidence_keys.length;
    m.citations_invalid += c.evidence_keys.filter((k) => !valid.has(k)).length;
    if (c.evidence_class === "verified" && !c.evidence_keys.some((k) => observed.has(k))) m.verified_unsupported++;
    if ((c.evidence_class === "inferred" || c.evidence_class === "estimated") && !c.basis?.trim()) m.basis_missing++;
  };
  if (out.profile) {
    const pr = out.profile;
    [pr.what_it_does, pr.geography, pr.value_proposition, ...pr.services, ...pr.audience, ...pr.contact_methods].forEach(claim);
  }
  if (out.findings) {
    m.findings = out.findings.findings.length;
    out.findings.findings.forEach(claim);
  }
  if (out.drafts) {
    const d = out.drafts;
    const source = sourceText(p);
    const texts = [d.homepage.headline, d.homepage.subheadline, d.homepage.call_to_action, ...d.seo.flatMap((s) => [s.title, s.meta_description])];
    const all = texts.join("\n");
    m.draft_numbers_not_in_source = [...new Set(all.replace(/\[[^\]]*\]/g, "").match(/\d[\d,.:-]*\d|\d/g) ?? [])].filter((n) => !source.includes(n));
    m.draft_promises = texts.filter((t) => PROMISES.test(t)).length;
    m.draft_system_leaks = texts.filter((t) => leaksSystemText(t)).length;
    m.seo_items = d.seo.length;
    m.seo_title_in_range = d.seo.filter((s) => s.title.length >= 30 && s.title.length <= 60).length;
    m.seo_meta_in_range = d.seo.filter((s) => s.meta_description.length >= 70 && s.meta_description.length <= 160).length;
    m.headline_in_limit = d.homepage.headline.length <= 70 && d.homepage.subheadline.length <= 160 && d.homepage.call_to_action.length <= 30;
    m.business_name_used = all.toLowerCase().includes(p.site.business_name.toLowerCase());
    m.placeholders = (all.match(/\[[^\]]+\]/g) ?? []).length;
    d.facts_used.forEach((f) => {
      m.citations_total += f.evidence_keys.length;
      m.citations_invalid += f.evidence_keys.filter((k) => !valid.has(k)).length;
    });
  }
  return m;
}

/** Cost in US dollars from token counts and the per-million-token prices supplied for the run. */
export const costUsd = (inputTokens: number, outputTokens: number, inPerM: number, outPerM: number) => (inputTokens * inPerM + outputTokens * outPerM) / 1_000_000;
