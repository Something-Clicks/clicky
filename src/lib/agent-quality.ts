/**
 * Quality screening for the Marketing Agent's output (specification §3.4, §5, §7): factual accuracy,
 * evidence, business relevance, marketing usefulness and actionability, plus flags for unsupported
 * claims and generic advice.
 *
 * This is a SCREENING AID for the person reviewing agent output, not a measure of truth and not a model
 * judging a model. It is fixed code that applies the same rules every time:
 *  - what it can measure: does each finding quote evidence, does a verified finding really have some,
 *    are inferences explained, do figures and promises appear that the evidence does not support,
 *    does the text name this business's own services, place or customers, does it read as generic,
 *    does each recommendation say a concrete thing to do;
 *  - what it cannot measure: whether a quote was understood correctly, whether advice is right for the
 *    business, whether a plan is wise. Those need a person (the admin review page puts the evidence
 *    beside every item for that reason).
 * Scores are 0-100 per dimension; a dimension with nothing to judge is null, never a flattering 100.
 */
import { claimProblemIn, genericPhraseIn, promisesQuoted, unsupportedNumbers } from "./server/agent/grounding";

export interface ReviewFact {
  category: string; field: string; value: string | null; source: string; evidence_class: string;
  basis: string | null; evidence: { kind?: string; url?: string | null; excerpt?: string | null }[] | null; status: string;
}
export interface ReviewFinding {
  title: string; explanation: string; why_it_matters: string; recommended_action: string; impact: string; confidence: string;
  evidence_class: string | null; evidence_basis: string | null; origin: string; evidence: (string | null)[] | null;
}
export interface ReviewPlan {
  summary?: string; objectives?: { objective: string; based_on?: string[] }[];
  priorities?: { card_id: string; order: number; why_now: string; effort: string; based_on?: string[]; depends_on?: string[] }[];
  next_steps?: string[]; questions?: string[]; not_now?: { card_id: string; reason: string }[];
}
export interface ReviewInput {
  businessName: string;
  facts: ReviewFact[];
  findings: ReviewFinding[];
  plan: ReviewPlan | null;
}

export const DIMENSIONS = ["factual_accuracy", "evidence", "business_relevance", "marketing_usefulness", "actionability"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface QualityFlag {
  severity: "problem" | "warning";
  area: "fact" | "finding" | "plan";
  kind: "unsupported_claim" | "unsupported_figure" | "no_evidence" | "missing_basis" | "generic" | "not_specific" | "not_actionable" | "thin";
  item: string;
  message: string;
}

export interface QualityReport {
  scores: Record<Dimension, number | null>;
  /** Mean of the dimensions that could be judged; null when none could. */
  overall: number | null;
  flags: QualityFlag[];
  counts: { facts: number; findings: number; priorities: number };
}

const STOP = new Set(["that", "this", "with", "your", "from", "have", "will", "into", "about", "their", "they", "them", "what", "when", "where", "which", "more", "than", "also", "such", "page", "site", "website", "business", "service", "services", "customer", "customers", "homepage"]);
const tokens = (s: string) => s.toLowerCase().match(/[a-z][a-z'-]{3,}/g)?.filter((t) => !STOP.has(t)) ?? [];

const pct = (good: number, total: number) => (total === 0 ? null : Math.round((good / total) * 100));
const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const clip = (s: string) => (s.length > 70 ? `${s.slice(0, 67)}...` : s);
const hasConcreteAction = (s: string) => /^\s*(add|write|rewrite|change|replace|put|move|create|include|list|name|show|link|update|fix|remove|publish|ask|call|send|set|use|make|reduce|compress|resize|claim|respond|reply|collect|display|state|describe|explain|split|combine|shorten|expand|check)\b/i.test(s) && s.trim().split(/\s+/).length >= 5;

export function reviewQuality(input: ReviewInput): QualityReport {
  const flags: QualityFlag[] = [];
  const flag = (f: QualityFlag) => flags.push(f);

  // What may support a figure. Facts and model findings must be supported by quoted evidence (or, for findings,
  // details the owner confirmed): their own text never counts as its own support. Findings from the fixed checks
  // state measurements (title length, speed) that live in measured evidence, so figures are not screened there.
  const excerpts = [
    ...input.facts.flatMap((f) => (f.evidence ?? []).map((e) => e.excerpt ?? "")),
    ...input.findings.flatMap((f) => (f.evidence ?? []).map((e) => e ?? "")),
  ];
  const evidenceSource = [input.businessName, ...excerpts].join("\n");
  const findingSource = [evidenceSource, ...input.facts.filter((f) => f.status === "confirmed" || f.source === "owner").map((f) => f.value ?? "")].join("\n");
  // The plan may cite figures that appear in the actions it was built from.
  const source = [findingSource, ...input.facts.map((f) => f.value ?? ""), ...input.findings.flatMap((f) => [f.title, f.explanation, f.why_it_matters, f.recommended_action])].join("\n");
  const own = new Set([...tokens(input.businessName), ...input.facts.filter((f) => f.value && f.status !== "rejected").flatMap((f) => tokens(f.value!))]);
  const names = (text: string) => tokens(text).some((t) => own.has(t));
  const generic = genericPhraseIn;

  // ── facts ──
  const judged = input.facts.filter((f) => f.evidence_class !== "unknown" && f.value);
  let factsOk = 0;
  for (const f of judged) {
    const item = `${f.field}: ${clip(f.value!)}`;
    const quoted = (f.evidence ?? []).some((e) => (e.excerpt ?? "").trim().length >= 4);
    let ok = true;
    if (f.evidence_class === "verified" && !quoted) { flag({ severity: "problem", area: "fact", kind: "no_evidence", item, message: "Marked verified but no quoted evidence is attached." }); ok = false; }
    if (f.evidence_class === "inferred" && !quoted) { flag({ severity: "problem", area: "fact", kind: "no_evidence", item, message: "Inferred without any quoted evidence." }); ok = false; }
    if ((f.evidence_class === "inferred" || f.evidence_class === "estimated") && !f.basis?.trim()) { flag({ severity: "problem", area: "fact", kind: "missing_basis", item, message: "States no basis for the inference." }); ok = false; }
    const claim = claimProblemIn(f.value!);
    if (claim === "promise" && !(f.field === "trust_signal" && promisesQuoted(f.value!, (f.evidence ?? []).map((e) => e.excerpt)))) { flag({ severity: "problem", area: "fact", kind: "unsupported_claim", item, message: "Contains a promise or ranking claim." }); ok = false; }
    if (unsupportedNumbers(f.value!, evidenceSource).length) { flag({ severity: "problem", area: "fact", kind: "unsupported_figure", item, message: "Contains a figure that appears nowhere in the evidence." }); ok = false; }
    if (ok) factsOk++;
  }

  // ── findings ──
  let findingsOk = 0, evidenced = 0, relevant = 0, useful = 0, actionable = 0;
  for (const f of input.findings) {
    const item = clip(f.title);
    const texts = [f.title, f.explanation, f.why_it_matters, f.recommended_action];
    const all = texts.join(" ");
    let ok = true;
    const quoted = (f.evidence ?? []).some((e) => (e ?? "").trim().length >= 4);
    if (quoted) evidenced++;
    else if (f.origin === "model") { flag({ severity: "problem", area: "finding", kind: "no_evidence", item, message: "A model finding with no quoted evidence." }); ok = false; }
    if (f.origin === "model" && f.evidence_class === "inferred" && !f.evidence_basis?.trim()) { flag({ severity: "problem", area: "finding", kind: "missing_basis", item, message: "Inferred without a stated basis." }); ok = false; }
    if (texts.some((t) => claimProblemIn(t) === "promise")) { flag({ severity: "problem", area: "finding", kind: "unsupported_claim", item, message: "Contains a promise or ranking claim." }); ok = false; }
    if (f.origin === "model" && texts.some((t) => unsupportedNumbers(t, findingSource).length)) { flag({ severity: "warning", area: "finding", kind: "unsupported_figure", item, message: "Contains a figure the evidence does not show." }); ok = false; }
    const g = generic(all);
    if (g) flag({ severity: "warning", area: "finding", kind: "generic", item, message: `Reads as generic advice ("${g}").` });
    if (names(all) || /\b(title|description|heading|phone|mobile|speed|image|page|link|button|form)\b/i.test(all)) relevant++;
    else flag({ severity: "warning", area: "finding", kind: "not_specific", item, message: "Names nothing specific to this business or its pages." });
    if (!g && f.explanation.trim().length >= 40 && f.why_it_matters.trim().length >= 40) useful++;
    else if (!g) flag({ severity: "warning", area: "finding", kind: "thin", item, message: "The explanation or the reason it matters is very short." });
    if (hasConcreteAction(f.recommended_action)) actionable++;
    else flag({ severity: "warning", area: "finding", kind: "not_actionable", item, message: "The recommended action does not start with a clear, concrete step." });
    if (ok) findingsOk++;
  }

  // ── plan ──
  const plan = input.plan;
  const prios = plan?.priorities ?? [];
  let planRelevant = 0, planSpecific = 0, planActionable = 0;
  if (plan) {
    const planTexts = [plan.summary ?? "", ...(plan.objectives ?? []).map((o) => o.objective), ...(plan.next_steps ?? []), ...(plan.questions ?? [])];
    for (const t of planTexts.filter(Boolean)) {
      const item = clip(t);
      if (claimProblemIn(t)) flag({ severity: "problem", area: "plan", kind: "unsupported_claim", item, message: "Contains a promise or ranking claim." });
      if (unsupportedNumbers(t, source).length) flag({ severity: "problem", area: "plan", kind: "unsupported_figure", item, message: "Contains a figure that appears nowhere in the material." });
      const g = generic(t);
      if (g) flag({ severity: "warning", area: "plan", kind: "generic", item, message: `Reads as generic advice ("${g}").` });
    }
    for (const p of prios) {
      const item = clip(p.why_now);
      if (claimProblemIn(p.why_now)) flag({ severity: "problem", area: "plan", kind: "unsupported_claim", item, message: "Contains a promise or ranking claim." });
      const g = generic(p.why_now);
      if (g) flag({ severity: "warning", area: "plan", kind: "generic", item, message: `Reads as generic advice ("${g}").` });
      if ((p.based_on?.length ?? 0) > 0 || names(p.why_now)) planRelevant++;
      else flag({ severity: "warning", area: "plan", kind: "not_specific", item, message: "The reason names no detail of this business." });
      if (!g && p.why_now.trim().length >= 40) planSpecific++;
      else if (!g) flag({ severity: "warning", area: "plan", kind: "thin", item, message: "The reason for this priority is very short." });
      if (["small", "medium", "large"].includes(p.effort)) planActionable++;
    }
    const steps = plan.next_steps ?? [];
    if (steps.length === 0) flag({ severity: "warning", area: "plan", kind: "not_actionable", item: "next steps", message: "The plan has no concrete next steps." });
    for (const s of steps) if (!hasConcreteAction(s)) flag({ severity: "warning", area: "plan", kind: "not_actionable", item: clip(s), message: "A next step that does not start with a clear action." });
  }

  const planStepsOk = plan ? (plan.next_steps ?? []).filter(hasConcreteAction).length : 0;
  const planStepsTotal = plan ? (plan.next_steps ?? []).length : 0;
  const planClaimFlags = flags.filter((f) => f.area === "plan" && (f.kind === "unsupported_claim" || f.kind === "unsupported_figure")).length;

  const scores: Record<Dimension, number | null> = {
    // accuracy: items whose claims are all supported by evidence the agent holds (facts and findings), minus plan claim problems
    factual_accuracy: pct(factsOk + findingsOk + Math.max(0, prios.length - planClaimFlags), judged.length + input.findings.length + prios.length),
    evidence: pct(judged.filter((f) => (f.evidence ?? []).some((e) => (e.excerpt ?? "").trim().length >= 4)).length + evidenced, judged.length + input.findings.length),
    business_relevance: pct(relevant + planRelevant, input.findings.length + prios.length),
    marketing_usefulness: pct(useful + planSpecific, input.findings.length + prios.length),
    actionability: pct(actionable + planActionable + planStepsOk, input.findings.length + prios.length + planStepsTotal),
  };

  return {
    scores,
    overall: mean(Object.values(scores)),
    flags: flags.sort((a, b) => Number(b.severity === "problem") - Number(a.severity === "problem")),
    counts: { facts: judged.length, findings: input.findings.length, priorities: prios.length },
  };
}
