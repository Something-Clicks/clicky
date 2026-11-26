/**
 * Model check: drives the REAL Marketing Agent capabilities (business understanding, model findings, strategy plan,
 * drafts) against a model server through the self-hosted adapter, on websites it is given, and records the AUTOMATIC
 * measurements (answers usable, retries, time, tokens, how much survives our grounding checks, estimated compute cost).
 * Quality (is it true, useful, well written) is judged by people from the saved raw outputs (MODEL_EVALUATION_PLAN.md);
 * nothing here grades a model. No database, no customer data, nothing is stored in the app.
 */
import { learnWithModel } from "@/lib/server/agent/modules/business-understanding";
import { understand } from "@/lib/server/agent/modules/business-intelligence";
import { sourcePages } from "@/lib/server/agent/modules/business-understanding";
import type { ProposedFact, StoredFact } from "@/lib/business-profile";
import type { KnownFact } from "@/lib/server/agent/modules/business-intelligence";
import { ContentRejected, createContent, type ContentInput, type DraftKind } from "@/lib/server/agent/modules/content-creation";
import { analyzeWithModel } from "@/lib/server/agent/modules/marketing-analysis-model";
import { createPlan, PlanRejected } from "@/lib/server/agent/modules/marketing-strategy";
import { ModelOutputInvalid, type ModelProvider } from "@/lib/server/agent/provider";
import type { AnalysisDeps } from "@/lib/server/analysis";
import type { FetchedPage } from "@/lib/server/safe-fetch";

import { checkSite, type SiteReport } from "../sitecheck/run";
import { checkCase } from "./checks";
import type { EvalCase } from "./dataset/types";
import type { CallRecord, CaseRun, TaskResult } from "./types";

export type { CallRecord, TaskResult } from "./types";

export interface ModelCheckReport {
  provider: string;
  model: string;
  startedAt: string;
  sites: string[];
  tasks: TaskResult[];
  summary: ReturnType<typeof summarize>;
}

/** Wraps a provider to record every attempt (a retry is a second attempt). */
export function instrument(inner: ModelProvider): { provider: ModelProvider; calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  return {
    calls,
    provider: {
      id: inner.id,
      model: inner.model,
      attemptTimeoutMs: inner.attemptTimeoutMs,
      async generate(req) {
        const t0 = Date.now();
        try {
          const r = await inner.generate(req);
          calls.push({ task: req.task, ms: Date.now() - t0, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, refused: Boolean(r.refused), error: null });
          return r;
        } catch (error) {
          calls.push({ task: req.task, ms: Date.now() - t0, inputTokens: 0, outputTokens: 0, refused: false, error: error instanceof Error ? error.name : "error" });
          throw error;
        }
      },
    },
  };
}

const histogram = (reasons: string[]) => reasons.reduce<Record<string, number>>((h, r) => ((h[r] = (h[r] ?? 0) + 1), h), {});
const failureOf = (e: unknown) =>
  e instanceof ModelOutputInvalid ? `unusable:${e.reason}` : e instanceof ContentRejected ? "draft_rejected_by_content_rules" : e instanceof PlanRejected ? `plan_rejected:${e.reason}` : e instanceof Error ? `error:${e.name}` : "error";

async function timed(site: string, task: string, inner: ModelProvider, run: (p: ModelProvider) => Promise<{ yield: TaskResult["yield"]; output: unknown }>): Promise<TaskResult> {
  const { provider, calls } = instrument(inner);
  const t0 = Date.now();
  let ok = true, failure: string | null = null, y: TaskResult["yield"] = null, output: unknown = null;
  try {
    ({ yield: y, output } = await run(provider));
  } catch (error) {
    ok = false;
    failure = failureOf(error);
  }
  return {
    site, task, ok, failure, ms: Date.now() - t0, attempts: calls.length,
    maxCallMs: calls.reduce((m, c) => Math.max(m, c.ms), 0), refusals: calls.filter((c) => c.refused).length,
    inputTokens: calls.reduce((n, c) => n + c.inputTokens, 0), outputTokens: calls.reduce((n, c) => n + c.outputTokens, 0), yield: y, output,
  };
}

/** Which fixed-check finding each draft kind is written from: the same for every candidate, so drafts are comparable. */
const DRAFT_SOURCE: Record<DraftKind, string[]> = {
  meta: ["meta.description_missing", "meta.title_length", "meta.title_missing"],
  page_copy: ["content.h1_missing", "content.thin_homepage"],
};

export interface RunSiteOptions {
  /** Owner-note variants for the plan task (id and the owner's words); each runs as its own task "plan_notes:<id>". */
  notes?: { id: string; text: string }[];
}

export async function runSite(inner: ModelProvider, website: string, biz: { businessName: string; serviceArea: string | null; primaryGoal: string | null }, deps: AnalysisDeps = {}, ownerNotes: string | null = null, options: RunSiteOptions = {}): Promise<{ site: SiteReport; tasks: TaskResult[] }> {
  const site = await checkSite(website, biz, deps);
  if (!site.ok || !site.scan) return { site, tasks: [{ site: website, task: "scan", ok: false, failure: "site_not_scanned", ms: 0, attempts: 0, maxCallMs: 0, refusals: 0, inputTokens: 0, outputTokens: 0, yield: null, output: site.reason ?? null }] };
  const scan = site.scan;
  let known: KnownFact[] = [];
  const tasks: TaskResult[] = [];

  const understandingTask = await timed(website, "understanding", inner, async (p) => {
    const r = await learnWithModel(p, scan, { businessName: biz.businessName, serviceArea: biz.serviceArea });
    return { yield: { proposed: r.accepted.length + r.rejected.length, kept: r.accepted.length, rejectedReasons: histogram(r.rejected.map((x) => x.reason)) }, output: { accepted: r.accepted, rejected: r.rejected } };
  });
  tasks.push(understandingTask);
  // As in the product, later steps receive the business details built so far: the fixed extraction plus what the model proposed.
  {
    const modelFacts = understandingTask.ok ? (understandingTask.output as { accepted: ProposedFact[] }).accepted : [];
    const stored: StoredFact[] = [...site.facts, ...modelFacts].map((f, i) => ({ ...f, id: `fact${i}`, status: "proposed", observed_at: new Date().toISOString(), confirmed_at: null }));
    known = understand({ businessName: biz.businessName, website, serviceArea: biz.serviceArea, primaryGoal: biz.primaryGoal }, stored).known;
  }

  const findingsTask = await timed(website, "findings", inner, async (p) => {
    const r = await analyzeWithModel(p, { pages: sourcePages(scan), businessName: biz.businessName, known, alreadyFound: site.findings.map((f) => f.title) });
    return { yield: { proposed: r.cards.length + r.rejected.length, kept: r.cards.length, rejectedReasons: histogram(r.rejected.map((x) => x.reason)) }, output: { cards: r.cards, evidence: r.evidence, rejected: r.rejected } };
  });
  tasks.push(findingsTask);

  // As in the product, the plan works from every open action: the fixed checks AND the model's own accepted findings.
  const modelCards = findingsTask.ok ? ((findingsTask.output as { cards: Record<string, unknown>[] }).cards ?? []) : [];
  const planCards = [
    ...site.findings.map((f) => ({ id: f.id, title: f.title, why_it_matters: f.why_it_matters, recommended_action: f.recommended_action, impact: f.impact, confidence: f.confidence, evidence_class: f.evidence_class, stage: "prepared" })),
    ...modelCards.map((c, i) => ({ id: `m${i + 1}`, title: String(c.title), why_it_matters: String(c.why_it_matters), recommended_action: String(c.recommended_action), impact: String(c.impact_priority), confidence: String(c.confidence), evidence_class: String(c.evidence_class ?? "inferred"), stage: "prepared" })),
  ];
  const planTask = (name: string, notes: string | null) => timed(website, name, inner, async (p) => {
    const r = await createPlan(p, { businessName: biz.businessName, serviceArea: biz.serviceArea, primaryGoal: biz.primaryGoal, known, ownerNotes: notes, cards: planCards });
    return { yield: { proposed: r.plan.priorities.length + r.rejected.length, kept: r.plan.priorities.length, rejectedReasons: histogram(r.rejected.map((x) => x.reason)) }, output: { plan: r.plan, cards: planCards.map((c) => ({ id: c.id, title: c.title, impact: c.impact, check_key: site.findings.find((f) => f.id === c.id)?.check_key ?? "model" })) } };
  });
  tasks.push(await planTask(ownerNotes ? "plan_with_notes" : "plan", ownerNotes));
  for (const n of options.notes ?? []) tasks.push(await planTask(`plan_notes:${n.id}`, n.text));

  for (const kind of ["meta", "page_copy"] as DraftKind[]) {
    const card = DRAFT_SOURCE[kind].map((k) => site.findings.find((f) => f.check_key === k)).find(Boolean) ?? site.findings[0];
    tasks.push(await timed(website, `draft_${kind}`, inner, async (p) => {
      const input: ContentInput = {
        kind, businessName: biz.businessName, known, ownerNotes: null,
        card: { title: card?.title ?? "Say clearly what the business does", explanation: card?.explanation ?? "", recommendedAction: card?.recommended_action ?? "" },
        evidence: (card?.evidence ?? []).map((e) => ({ url: e.url, observation: e.observation, excerpt: e.excerpt })),
      };
      const r = await createContent(p, input);
      return { yield: null, output: r.fields };
    }));
  }
  return { site, tasks };
}

const fetchFromCase = (c: EvalCase) => async (url: string): Promise<FetchedPage> => {
  const body = c.pages[new URL(url).pathname || "/"];
  return { url, status: body ? 200 : 404, contentType: "text/html", body: body ?? "", truncated: false, redirects: [] };
};

/** Runs one dataset case against a model, then applies every automatic check to what came back. */
export async function runEvalCase(inner: ModelProvider, c: EvalCase, allBusinessNames: string[] = []): Promise<CaseRun> {
  const website = `https://${c.id.toLowerCase()}.example/`;
  const { site, tasks } = await runSite(inner, website, { businessName: c.business.name, serviceArea: c.business.serviceArea, primaryGoal: c.business.primaryGoal },
    { fetchPage: fetchFromCase(c), pageSpeed: async () => ({ ok: false as const, reason: "not measured" }) }, null, { notes: c.notes.map((n) => ({ id: n.id, text: n.text })) });
  return { caseId: c.id, tasks, checks: site.ok ? checkCase(c, tasks, allBusinessNames, site.facts) : null };
}

const pct = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]! : 0);

export function summarize(tasks: TaskResult[], gpuUsdPerHour: number | null) {
  const ran = tasks.filter((t) => t.task !== "scan");
  const sites = [...new Set(ran.map((t) => t.site))];
  const proposed = ran.reduce((n, t) => n + (t.yield?.proposed ?? 0), 0);
  const kept = ran.reduce((n, t) => n + (t.yield?.kept ?? 0), 0);
  const secondsBySite = sites.map((s) => ran.filter((t) => t.site === s).reduce((n, t) => n + t.ms, 0) / 1000);
  const outTok = ran.reduce((n, t) => n + t.outputTokens, 0);
  const totalSec = ran.reduce((n, t) => n + t.ms, 0) / 1000;
  return {
    tasks: ran.length,
    usable: ran.filter((t) => t.ok).length,
    usablePct: ran.length ? Math.round((1000 * ran.filter((t) => t.ok).length) / ran.length) / 10 : 0,
    firstAttemptPct: ran.length ? Math.round((1000 * ran.filter((t) => t.attempts === 1 && t.ok).length) / ran.length) / 10 : 0,
    failures: histogram(ran.filter((t) => !t.ok).map((t) => t.failure ?? "error")),
    groundedYieldPct: proposed ? Math.round((1000 * kept) / proposed) / 10 : null,
    taskSecondsP50: pct(ran.map((t) => t.ms / 1000), 0.5),
    taskSecondsP95: pct(ran.map((t) => t.ms / 1000), 0.95),
    businessSeconds: secondsBySite.map((s) => Math.round(s)),
    outputTokensPerSecond: totalSec ? Math.round((10 * outTok) / totalSec) / 10 : 0,
    inputTokens: ran.reduce((n, t) => n + t.inputTokens, 0),
    outputTokens: outTok,
    // Compute cost if the GPU were busy the whole time (100% utilization), per business: seconds × hourly price.
    estimatedComputeUsdPerBusiness: gpuUsdPerHour && secondsBySite.length ? Math.round((1e4 * (secondsBySite.reduce((a, b) => a + b, 0) / secondsBySite.length) * gpuUsdPerHour) / 3600) / 1e4 : null,
  };
}

export function toMarkdown(r: ModelCheckReport): string {
  const s = r.summary;
  return [
    `# Model check: ${r.provider} / ${r.model}`, "",
    `Started ${r.startedAt}. Sites: ${r.sites.join(", ")}. These are AUTOMATIC measurements only; quality is judged by people from the saved outputs.`, "",
    "| Measure | Value |", "|---|---|",
    `| Tasks run / usable | ${s.tasks} / ${s.usable} (${s.usablePct}%) |`,
    `| Usable on the first attempt | ${s.firstAttemptPct}% |`,
    `| Failures | ${Object.entries(s.failures).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"} |`,
    `| Survives our grounding checks | ${s.groundedYieldPct === null ? "n/a" : `${s.groundedYieldPct}%`} of proposed items |`,
    `| Seconds per task (p50 / p95) | ${s.taskSecondsP50} / ${s.taskSecondsP95} |`,
    `| Seconds per business | ${s.businessSeconds.join(", ")} |`,
    `| Output tokens per second | ${s.outputTokensPerSecond} |`,
    `| Tokens in / out | ${s.inputTokens} / ${s.outputTokens} |`,
    `| Estimated compute per business at 100% GPU use | ${s.estimatedComputeUsdPerBusiness === null ? "set MODELCHECK_GPU_USD_PER_HOUR" : `$${s.estimatedComputeUsdPerBusiness}`} |`,
    "", "## Per task", "| Site | Task | OK | Attempts | Seconds | Kept / proposed | Failure |", "|---|---|---|---|---|---|---|",
    ...r.tasks.map((t) => `| ${t.site} | ${t.task} | ${t.ok ? "yes" : "no"} | ${t.attempts} | ${Math.round(t.ms / 100) / 10} | ${t.yield ? `${t.yield.kept} / ${t.yield.proposed}` : "–"} | ${t.failure ?? ""} |`),
    "",
  ].join("\n");
}
