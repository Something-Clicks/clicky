/**
 * Strict structured-output acceptance check against Groq, on every REAL agent schema. Not part of the frozen evaluation (it adds,
 * changes and scores nothing in the dataset): it uses one fictional dev-set business as input and asks only
 *   (1) did Groq ACCEPT the schema in the configured mode (no HTTP 400)?                       -> "provider" column
 *   (2) did the answer come back as complete JSON (not cut off by the output allowance)?      -> "complete"
 *   (3) did it pass OUR validation (the original zod schema, with every length/pattern rule)? -> "valid"
 * so "Groq rejected the schema", "the free output allowance was too small" and "the model's answer failed our checks" are never mixed.
 *
 *   MODELCHECK_PROVIDER=groq GROQ_API_KEY=… GROQ_MODEL=openai/gpt-oss-120b pnpm exec vitest run --project modelcheck evals/model/schemacheck.eval.ts
 * Optional: SCHEMACHECK_REPEATS (default 1; each repeat is another full pass and spends free-tier tokens), SCHEMACHECK_CASE (default D1),
 * GROQ_LIMITER_STATE_FILE (share the rolling free allowance with other runs), EVAL_RESULTS_DIR.
 * Writes eval-results/schemacheck-<model>-<time>.json and .md.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { understand } from "@/lib/server/agent/modules/business-intelligence";
import { learnWithModel, sourcePages } from "@/lib/server/agent/modules/business-understanding";
import { ContentRejected, createContent, createTaskDraft, type ChannelKind, type ContentInput } from "@/lib/server/agent/modules/content-creation";
import { analyzeWithModel } from "@/lib/server/agent/modules/marketing-analysis-model";
import { createPlan } from "@/lib/server/agent/modules/marketing-strategy";
import { ModelOutputInvalid, ModelThrottled, type ModelProvider } from "@/lib/server/agent/provider";
import { groqProvider } from "@/lib/server/agent/providers/groq";
import type { StoredFact } from "@/lib/business-profile";
import type { FetchedPage } from "@/lib/server/safe-fetch";

import { checkSite } from "../sitecheck/run";
import { ALL_CASES } from "./dataset";

const provider = process.env.MODELCHECK_PROVIDER === "groq" ? groqProvider(process.env) : null;
const repeats = Math.max(1, Number(process.env.SCHEMACHECK_REPEATS ?? 1));
const caseId = process.env.SCHEMACHECK_CASE ?? "D1";
const OUT = process.env.EVAL_RESULTS_DIR ?? "eval-results";

interface Row { schema: string; pass: number; call: number; providerStatus: Record<string, number>; complete: number; valid: number; tokensIn: number; tokensOut: number; notes: string[] }

describe.skipIf(!provider)("Groq strict mode on every real agent schema", () => {
  it("accepts each schema and returns complete, valid JSON", async () => {
    const c = ALL_CASES.find((x) => x.id === caseId)!;
    const rows = new Map<string, Row>();
    const row = (schema: string) => { let r = rows.get(schema); if (!r) rows.set(schema, (r = { schema, pass: 0, call: 0, providerStatus: {}, complete: 0, valid: 0, tokensIn: 0, tokensOut: 0, notes: [] })); return r; };

    // Records Groq's own outcome per call: accepted (HTTP 200), HTTP status when rejected, or throttled; and whether the JSON came back whole.
    const recording: ModelProvider = {
      id: provider!.id, model: provider!.model, attemptTimeoutMs: provider!.attemptTimeoutMs,
      async generate(req) {
        const r = row(req.task);
        r.call += 1;
        try {
          const out = await provider!.generate(req);
          r.providerStatus["200"] = (r.providerStatus["200"] ?? 0) + 1;
          if (out.output !== null && !out.refused) r.complete += 1; else r.notes.push(out.refused ? "refused" : "no complete JSON (cut off or mismatch)");
          r.tokensIn += out.usage.inputTokens; r.tokensOut += out.usage.outputTokens;
          return out;
        } catch (e) {
          const key = e instanceof ModelThrottled ? `throttled:${e.kind}` : String((e as { status?: number }).status ?? "error");
          r.providerStatus[key] = (r.providerStatus[key] ?? 0) + 1;
          throw e;
        }
      },
    };
    const only = (process.env.SCHEMACHECK_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const validated = async <T,>(schema: string, run: () => Promise<T>): Promise<T | null> => {
      // Optional: SCHEMACHECK_ONLY=content_creation.page_copy,... runs only those schemas (the others still get their inputs from fixed checks).
      if (only.length && !only.includes(schema)) return null;
      try { const v = await run(); row(schema).valid += 1; return v; }
      catch (e) { row(schema).notes.push(e instanceof ModelOutputInvalid ? `invalid:${e.reason}` : e instanceof ContentRejected ? `content_rules:${e.reason}` : e instanceof ModelThrottled ? `throttled:${e.kind}` : `error:${e instanceof Error ? e.name : "?"}`); return null; }
    };

    const fetchPage = async (url: string): Promise<FetchedPage> => { const b = c.pages[new URL(url).pathname || "/"]; return { url, status: b ? 200 : 404, contentType: "text/html", body: b ?? "", truncated: false, redirects: [] }; };
    const website = `https://${c.id.toLowerCase()}.example/`;
    const biz = { businessName: c.business.name, serviceArea: c.business.serviceArea, primaryGoal: c.business.primaryGoal };
    const site = await checkSite(website, biz, { fetchPage, pageSpeed: async () => ({ ok: false as const, reason: "not measured" }) });
    expect(site.ok && site.scan).toBeTruthy();
    const scan = site.scan!;

    for (let pass = 0; pass < repeats; pass++) {
      const u = await validated("business_intelligence.understand", () => learnWithModel(recording, scan, { businessName: biz.businessName, serviceArea: biz.serviceArea }));
      const stored: StoredFact[] = [...site.facts, ...(u?.accepted ?? [])].map((f, i) => ({ ...f, id: `fact${i}`, status: "proposed", observed_at: new Date().toISOString(), confirmed_at: null }));
      const known = understand({ businessName: biz.businessName, website, serviceArea: biz.serviceArea, primaryGoal: biz.primaryGoal }, stored).known;
      const f = await validated("marketing_analysis.review", () => analyzeWithModel(recording, { pages: sourcePages(scan), businessName: biz.businessName, known, alreadyFound: site.findings.map((x) => x.title) }));
      const cards = [
        ...site.findings.map((x) => ({ id: x.id, title: x.title, why_it_matters: x.why_it_matters, recommended_action: x.recommended_action, impact: x.impact, confidence: x.confidence, evidence_class: x.evidence_class, stage: "prepared" })),
        ...((f?.cards ?? []) as Record<string, unknown>[]).map((x, i) => ({ id: `m${i + 1}`, title: String(x.title), why_it_matters: String(x.why_it_matters), recommended_action: String(x.recommended_action), impact: String(x.impact_priority), confidence: String(x.confidence), evidence_class: String(x.evidence_class ?? "inferred"), stage: "prepared" })),
      ];
      await validated("marketing_strategy.plan", () => createPlan(recording, { businessName: biz.businessName, serviceArea: biz.serviceArea, primaryGoal: biz.primaryGoal, known, ownerNotes: null, cards }));
      for (const kind of ["meta", "page_copy"] as const) {
        const card = site.findings[0];
        const input: ContentInput = { kind, businessName: biz.businessName, known, ownerNotes: null, card: { title: card?.title ?? "Say clearly what the business does", explanation: card?.explanation ?? "", recommendedAction: card?.recommended_action ?? "" }, evidence: (card?.evidence ?? []).map((e) => ({ url: e.url, observation: e.observation, excerpt: e.excerpt })) };
        await validated(`content_creation.${kind}`, () => createContent(recording, input));
      }
      for (const channel of ["landing_page", "email", "social", "gbp", "sms"] as ChannelKind[]) {
        await validated(`content_creation.campaign_${channel}`, () => createTaskDraft(recording, {
          channel, businessName: biz.businessName, known,
          brief: { objective: `Get more ${c.business.primaryGoal === "more_calls" ? "calls" : "enquiries"} for ${biz.businessName}`, audience: null, offer: null, core_message: "Say plainly what the business does and how to reach it." },
          task: { title: `Write the ${channel.replace("_", " ")}`, why: "Customers need one clear next step." }, template: null, ownerNotes: null,
        }));
      }
    }

    const list = [...rows.values()].sort((a, b) => a.schema.localeCompare(b.schema));
    mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = `${OUT}/schemacheck-${provider!.model!.replace(/[^A-Za-z0-9._-]+/g, "_")}-${stamp}`;
    writeFileSync(`${file}.json`, JSON.stringify({ model: provider!.model, case: caseId, repeats, rows: list }, null, 2));
    writeFileSync(`${file}.md`, [
      `# Groq strict structured output: ${provider!.model} (case ${caseId}, ${repeats} pass${repeats === 1 ? "" : "es"})`, "",
      "| Schema | Groq calls | Groq accepted (HTTP 200) | Complete JSON | Valid for us | Tokens in/out | Notes |", "|---|---|---|---|---|---|---|",
      ...list.map((r) => `| ${r.schema} | ${r.call} | ${r.providerStatus["200"] ?? 0} | ${r.complete} | ${r.valid}/${repeats} | ${r.tokensIn}/${r.tokensOut} | ${[...new Set([...Object.entries(r.providerStatus).filter(([k]) => k !== "200").map(([k, v]) => `${k}×${v}`), ...r.notes])].join("; ") || ""} |`), "",
    ].join("\n"));
    console.log(`Schema check written to ${file}.md`);
    expect(list.length).toBeGreaterThan(0);
  }, 3 * 3_600_000);
});
