/**
 * Provider evaluation runner: `pnpm eval:providers` (see evals/providers/README.md).
 * Real websites and real provider APIs only. No mocks, no fallbacks: failures are recorded as failures.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { generateStructured, type ModelProvider } from "@/lib/server/agent/provider";

import { makeAdapter, type ProviderConfig, type ProviderId } from "./adapters";
import { loadSites, outDir, providerConfig, PROVIDERS, runsPerSite } from "./config";
import { buildPacket, userMessage, type SourcePacket } from "./material";
import { writeReport, type Results, type TaskRecord, type WorkflowRecord } from "./report";
import { costUsd, scoreWorkflow } from "./score";
import { TASK_ORDER, TASKS, type BusinessProfile, type Drafts, type Findings } from "./tasks";

/** Wraps an adapter to count attempts and time each call. */
function instrumented(inner: ModelProvider) {
  const stats = { attempts: 0, ms: 0 };
  const provider: ModelProvider = {
    id: inner.id,
    async generate(req) {
      stats.attempts++;
      const t = performance.now();
      try {
        return await inner.generate(req);
      } finally {
        stats.ms += performance.now() - t;
      }
    },
  };
  return { provider, stats };
}

async function runWorkflow(cfg: ProviderConfig, packet: SourcePacket, run: number, rawDir: string): Promise<WorkflowRecord> {
  const outputs: { profile: BusinessProfile | null; findings: Findings | null; drafts: Drafts | null } = { profile: null, findings: null, drafts: null };
  const tasks: TaskRecord[] = [];
  for (const name of TASK_ORDER) {
    const { provider, stats } = instrumented(makeAdapter(cfg));
    const task = TASKS[name];
    const input = userMessage(name, packet, { profile: outputs.profile, findings: outputs.findings });
    const rec: TaskRecord = { task: name, ok: false, attempts: 0, first_try_valid: false, latency_ms: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, error: null, model: null };
    try {
      const r = await generateStructured({ task: `eval.${name}`, system: task.system, input, schema: task.schema as never, maxOutputTokens: 16000 }, provider);
      Object.assign(rec, { ok: true, model: r.model, input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens });
      if (name === "business_profile") outputs.profile = r.output as BusinessProfile;
      if (name === "findings") outputs.findings = r.output as Findings;
      if (name === "drafts") outputs.drafts = r.output as Drafts;
    } catch (e) {
      rec.error = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 400) : String(e);
    }
    rec.attempts = stats.attempts;
    rec.first_try_valid = rec.ok && stats.attempts === 1;
    rec.latency_ms = Math.round(stats.ms);
    rec.cost_usd = costUsd(rec.input_tokens, rec.output_tokens, cfg.inputPerMTok, cfg.outputPerMTok);
    tasks.push(rec);
    if (!rec.ok) break; // a workflow that fails at one step is incomplete; later steps depend on it
  }
  const complete = tasks.length === TASK_ORDER.length && tasks.every((t) => t.ok);
  writeFileSync(join(rawDir, `${cfg.id}-${new URL(packet.site.url).hostname}-run${run}.json`), JSON.stringify(outputs, null, 2));
  return { provider: cfg.id, site: packet.site.url, run, complete, tasks, measured: complete ? scoreWorkflow(packet, outputs) : null };
}

/** Blind review packet: run 1 of each site, providers shuffled behind labels A/B/C. */
function writeReview(dir: string, packets: SourcePacket[], ran: ProviderId[]) {
  const reviewDir = join(dir, "review");
  mkdirSync(reviewDir, { recursive: true });
  const key: Record<string, ProviderId> = {};
  const csv = ["reviewer,site,label,accuracy,evidence_quality,business_specificity,copy_quality,notes"];
  for (const p of packets) {
    const host = new URL(p.site.url).hostname;
    const order = [...ran].sort(() => Math.random() - 0.5);
    const doc: string[] = [`# ${p.site.business_name} (${p.site.url})`, "", "Rate each label 1–5 on: accuracy, evidence quality, business specificity, copy quality. Check claims against the site itself.", ""];
    order.forEach((id, i) => {
      const label = "ABC"[i]!;
      key[`${host}|${label}`] = id;
      const raw = join(dir, "raw", `${id}-${host}-run1.json`);
      doc.push(`## ${label}`, "", "```json", existsSync(raw) ? readFileSync(raw, "utf8") : "(no output: the workflow failed)", "```", "");
      csv.push(`,${host},${label},,,,,`);
    });
    writeFileSync(join(reviewDir, `${host}.md`), doc.join("\n"));
  }
  writeFileSync(join(dir, "review-key.json"), JSON.stringify(key, null, 2)); // keep from reviewers until rated
  writeFileSync(join(dir, "ratings.template.csv"), csv.join("\n") + "\n");
}

const reportOnly = process.env.EVAL_REPORT_DIR;

it.runIf(!reportOnly)("runs the provider evaluation on real sites", async () => {
  const sites = loadSites();
  const runs = runsPerSite();
  const started = new Date().toISOString();
  const dir = join(outDir(), started.replace(/[:.]/g, "-"));
  mkdirSync(join(dir, "raw"), { recursive: true });
  mkdirSync(join(dir, "packets"), { recursive: true });

  const configs = PROVIDERS.map((id) => ({ id, c: providerConfig(id) }));
  const ready = configs.flatMap(({ c }) => (c.ok ? [c.cfg] : []));
  expect(ready.length, `No provider is configured: ${JSON.stringify(configs)}`).toBeGreaterThan(0);

  // Build each site's packet once; every provider gets the identical packet.
  // A site that can't be read is skipped for every provider (so all providers still see the same sites) and listed.
  const packets: SourcePacket[] = [];
  const unreadable: { url: string; reason: string }[] = [];
  for (const s of sites) {
    const packetFile = process.env.EVAL_PACKETS_DIR ? join(process.env.EVAL_PACKETS_DIR, `${new URL(s.url).hostname}.json`) : null;
    try {
      const packet = packetFile && existsSync(packetFile) ? (JSON.parse(readFileSync(packetFile, "utf8")) as SourcePacket) : await buildPacket(s);
      writeFileSync(join(dir, "packets", `${new URL(s.url).hostname}.json`), JSON.stringify(packet, null, 2));
      packets.push(packet);
    } catch (e) {
      unreadable.push({ url: s.url, reason: e instanceof Error ? e.message : String(e) });
      console.log(`Could not read ${s.url}: ${unreadable.at(-1)!.reason}`);
    }
  }
  expect(packets.length, `Fewer than 3 sites could be read: ${JSON.stringify(unreadable)}`).toBeGreaterThanOrEqual(3);

  const workflows: WorkflowRecord[] = [];
  for (const cfg of ready) {
    for (const packet of packets) {
      for (let run = 1; run <= runs; run++) {
        const w = await runWorkflow(cfg, packet, run, join(dir, "raw"));
        workflows.push(w);
        console.log(`${cfg.id} · ${packet.site.url} · run ${run}: ${w.complete ? "complete" : `FAILED (${w.tasks.find((t) => !t.ok)?.error})`}`);
      }
    }
  }

  const results: Results = {
    started_at: started,
    finished_at: new Date().toISOString(),
    sites: packets.map((p) => p.site.url),
    unreadable_sites: unreadable,
    runs_per_site: runs,
    providers: configs.map(({ id, c }) => ({
      id,
      model: c.ok ? (workflows.find((w) => w.provider === id)?.tasks.find((t) => t.model)?.model ?? c.cfg.model) : null,
      effort: c.ok ? c.cfg.effort : null,
      prices: c.ok ? [c.cfg.inputPerMTok, c.cfg.outputPerMTok] : null,
      not_run: c.ok ? null : c.missing,
    })),
    workflows,
  };
  writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2));
  writeReview(dir, packets, ready.map((c) => c.id));
  console.log(writeReport(dir));
  console.log(`Results: ${dir}`);
}, 3 * 60 * 60 * 1000);

it.runIf(Boolean(reportOnly))("rebuilds the report (with blind ratings, if present)", () => {
  console.log(writeReport(reportOnly!));
});
