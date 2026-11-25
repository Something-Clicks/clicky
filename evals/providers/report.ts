/**
 * Turns a results directory into report.md. Measured numbers come from results.json; subjective
 * scores come only from human reviewers' ratings.csv (blind: they see labels A/B/C, not provider names).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ProviderId } from "./adapters";
import type { Measured } from "./score";

export interface TaskRecord {
  task: string;
  ok: boolean;
  attempts: number;
  first_try_valid: boolean;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error: string | null;
  model: string | null;
}

export interface WorkflowRecord {
  provider: ProviderId;
  site: string;
  run: number;
  complete: boolean;
  tasks: TaskRecord[];
  measured: Measured | null;
}

export interface Results {
  started_at: string;
  finished_at: string;
  sites: string[];
  unreadable_sites: { url: string; reason: string }[];
  runs_per_site: number;
  providers: { id: ProviderId; model: string | null; effort: string | null; prices: [number, number] | null; not_run: string[] | null }[];
  workflows: WorkflowRecord[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const pctl = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const fmt = (n: number, d = 0) => (Number.isFinite(n) ? n.toFixed(d) : "n/a");

const RUBRIC = ["accuracy", "evidence_quality", "business_specificity", "copy_quality"] as const;

function humanScores(dir: string): Map<string, Record<string, number[]>> | null {
  const csv = join(dir, "ratings.csv");
  const keyFile = join(dir, "review-key.json");
  if (!existsSync(csv) || !existsSync(keyFile)) return null;
  const key = JSON.parse(readFileSync(keyFile, "utf8")) as Record<string, ProviderId>;
  const [header, ...rows] = readFileSync(csv, "utf8").trim().split(/\r?\n/).map((l) => l.split(","));
  const col = (name: string) => header!.indexOf(name);
  const out = new Map<string, Record<string, number[]>>();
  for (const r of rows) {
    const provider = key[`${r[col("site")]}|${r[col("label")]}`];
    if (!provider) continue;
    const agg = out.get(provider) ?? Object.fromEntries(RUBRIC.map((k) => [k, [] as number[]]));
    for (const k of RUBRIC) {
      const v = Number(r[col(k)]);
      if (v >= 1 && v <= 5) agg[k]!.push(v);
    }
    out.set(provider, agg);
  }
  return out;
}

export function writeReport(dir: string): string {
  const res = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as Results;
  const human = humanScores(dir);
  const lines: string[] = [];
  lines.push(`# Provider evaluation: ${res.started_at.slice(0, 10)}`, "");
  lines.push("Prepared by Claude, an Anthropic model, which is one of the providers evaluated. The harness applies identical inputs, instructions, schemas and mechanical checks to every provider; quality judgments come only from blind human ratings, not from Claude.", "");
  if (res.unreadable_sites.length) lines.push(`Sites that could not be read (skipped for every provider): ${res.unreadable_sites.map((u) => `${u.url} (${u.reason})`).join("; ")}`, "");
  lines.push(`Sites: ${res.sites.length} · runs per site: ${res.runs_per_site} · tasks per workflow: business profile → findings → drafts`, "");
  lines.push("## Configuration", "", "| Provider | Model (as reported) | Effort | Price in/out per 1M tokens | Status |", "|---|---|---|---|---|");
  for (const p of res.providers) {
    lines.push(`| ${p.id} | ${p.model ?? "-"} | ${p.effort ?? "default"} | ${p.prices ? `$${p.prices[0]} / $${p.prices[1]}` : "-"} | ${p.not_run ? `NOT RUN: missing ${p.not_run.join(", ")}` : "run"} |`);
  }
  lines.push("", "## Measured results", "", "| Metric | " + res.providers.map((p) => p.id).join(" | ") + " |", "|---|" + res.providers.map(() => "---").join("|") + "|");
  const by = (id: ProviderId) => res.workflows.filter((w) => w.provider === id);
  const row = (label: string, f: (ws: WorkflowRecord[]) => string) => lines.push(`| ${label} | ${res.providers.map((p) => (p.not_run ? "-" : f(by(p.id)))).join(" | ")} |`);
  const tasks = (ws: WorkflowRecord[]) => ws.flatMap((w) => w.tasks);
  const done = (ws: WorkflowRecord[]) => ws.filter((w) => w.complete);
  row("Complete workflows (reliability)", (ws) => `${done(ws).length}/${ws.length} (${pct(done(ws).length, ws.length)})`);
  row("Valid structured output, first try", (ws) => pct(tasks(ws).filter((t) => t.first_try_valid).length, tasks(ws).length));
  row("Valid structured output, after one retry", (ws) => pct(tasks(ws).filter((t) => t.ok).length, tasks(ws).length));
  row("Latency per workflow, median (s)", (ws) => fmt(pctl(done(ws).map((w) => w.tasks.reduce((a, t) => a + t.latency_ms, 0) / 1000), 0.5), 1));
  row("Latency per workflow, p90 (s)", (ws) => fmt(pctl(done(ws).map((w) => w.tasks.reduce((a, t) => a + t.latency_ms, 0) / 1000), 0.9), 1));
  row("Cost per complete workflow, mean (US$)", (ws) => `$${fmt(mean(done(ws).map((w) => w.tasks.reduce((a, t) => a + t.cost_usd, 0))), 4)}`);
  const m = (ws: WorkflowRecord[]) => done(ws).map((w) => w.measured!).filter(Boolean);
  row("Invalid citations (of all citations)", (ws) => pct(m(ws).reduce((a, x) => a + x.citations_invalid, 0), m(ws).reduce((a, x) => a + x.citations_total, 0)));
  row("\"Verified\" claims without observed evidence", (ws) => String(m(ws).reduce((a, x) => a + x.verified_unsupported, 0)));
  row("Inferred/estimated claims missing a basis", (ws) => String(m(ws).reduce((a, x) => a + x.basis_missing, 0)));
  row("Evidence classes used (V/I/E/U)", (ws) => {
    const c = (k: string) => m(ws).reduce((a, x) => a + (x.class_counts[k] ?? 0), 0);
    return `${c("verified")}/${c("inferred")}/${c("estimated")}/${c("unknown")}`;
  });
  row("Draft numbers not found in the source", (ws) => String(m(ws).reduce((a, x) => a + x.draft_numbers_not_in_source.length, 0)));
  row("Draft promises (guarantees, #1, ...)", (ws) => String(m(ws).reduce((a, x) => a + x.draft_promises, 0)));
  row("SEO titles 30–60 characters", (ws) => pct(m(ws).reduce((a, x) => a + x.seo_title_in_range, 0), m(ws).reduce((a, x) => a + x.seo_items, 0)));
  row("Meta descriptions 70–160 characters", (ws) => pct(m(ws).reduce((a, x) => a + x.seo_meta_in_range, 0), m(ws).reduce((a, x) => a + x.seo_items, 0)));
  row("Homepage copy within length limits", (ws) => pct(m(ws).filter((x) => x.headline_in_limit).length, m(ws).length));
  lines.push("", "## Subjective results (blind human ratings, 1–5)", "");
  if (!human) {
    lines.push("Not yet rated. Reviewers fill in `ratings.csv` from `review/` (labels A/B/C hide the provider), then run `EVAL_REPORT_DIR=" + dir + " pnpm eval:providers`.");
  } else {
    lines.push("| Criterion | " + res.providers.map((p) => p.id).join(" | ") + " |", "|---|" + res.providers.map(() => "---").join("|") + "|");
    for (const k of RUBRIC) lines.push(`| ${k.replace("_", " ")} | ${res.providers.map((p) => fmt(mean(human.get(p.id)?.[k] ?? []), 2)).join(" | ")} |`);
  }
  lines.push("", "## Errors", "");
  const errs = res.workflows.flatMap((w) => w.tasks.filter((t) => t.error).map((t) => `- ${w.provider} · ${w.site} · run ${w.run} · ${t.task}: ${t.error}`));
  lines.push(...(errs.length ? errs : ["None."]));
  const md = lines.join("\n") + "\n";
  writeFileSync(join(dir, "report.md"), md);
  return md;
}
