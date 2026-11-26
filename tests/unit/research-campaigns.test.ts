/**
 * Market research and campaign planning with NO model: fixed code on fixture websites with known truth. These prove the
 * rules (observed signals, honest gaps, no invention, evidence class and basis on every task), not marketing quality.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { campaignResults, planCampaigns, type CampaignInput } from "@/lib/campaigns";
import { compareSignals, readSignals, siteSignals } from "@/lib/research";
import { MODULES } from "@/lib/server/agent/modules";
import { runCampaignPlanning, runCompetitorResearch } from "@/lib/server/agent/orchestrator";
import { extractFacts } from "@/lib/server/site-scan";
import type { FetchedPage } from "@/lib/server/safe-fetch";

const fixture = (n: string) => readFileSync(join(__dirname, "..", "fixtures", "sites", n), "utf8");
const page = (url: string, body: string, status = 200): FetchedPage => ({ url, status, contentType: "text/html", body, truncated: false, redirects: [] });
const SITES: Record<string, string> = {
  "plumber.example": fixture("plumber.html"),
  "joes-lawn.example": fixture("thin-onepager.html"),
  "claims.example": fixture("claims-heavy.html"),
};
const fetchPage = async (url: string) => {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host === "down.example") throw new Error("boom with internals /etc/passwd");
  if (host === "missing.example") return page(url, "", 404);
  const body = SITES[host];
  if (!body) throw new Error("unknown host");
  return page(url, body);
};
const sig = (name: string) => siteSignals(extractFacts(page("https://x.example/", fixture(name))));

describe("site signals (observed on the homepage)", () => {
  it("reads what the plumber homepage really shows", () => {
    expect(sig("plumber.html")).toMatchObject({ phone: true, clickToCall: true, serviceArea: true, pricing: true, structuredData: true });
  });
  it("shows nothing for a thin one-pager and invents nothing", () => {
    expect(sig("thin-onepager.html")).toMatchObject({ phone: false, clickToCall: false, serviceArea: false, reviews: false, pricing: false, structuredData: false });
  });
  it("reads stored signals defensively", () => {
    expect(readSignals(null)).toBeNull();
    expect(readSignals({ phone: "yes", title: 5 })).toMatchObject({ phone: false, title: null, wordCount: 0 });
  });
  it("lists a gap only when they show something you don't", () => {
    const own = sig("thin-onepager.html");
    const rows = compareSignals(own, [{ host: "plumber.example", signals: sig("plumber.html") }]);
    expect(rows.find((r) => r.key === "clickToCall")).toMatchObject({ yours: false, gap: true, showing: ["plumber.example"], compared: 1 });
    expect(compareSignals(sig("plumber.html"), [{ host: "joes-lawn.example", signals: own }]).some((r) => r.gap)).toBe(false);
    expect(compareSignals(null, [])).toEqual([]);
  });
});

describe("market research module", () => {
  it("reads each named site, records failures in plain words and never leaks internals", async () => {
    const run = await MODULES.market_research.run({
      targets: [{ url: "https://plumber.example/", own: false }, { url: "https://down.example/", own: false }, { url: "https://missing.example/", own: false }],
      fetchPage,
    });
    expect(run.status).toBe("done");
    if (run.status !== "done") return;
    expect(run.output.map((r) => [r.host, r.status])).toEqual([["plumber.example", "done"], ["down.example", "failed"], ["missing.example", "failed"]]);
    expect(run.output[1]!.failure).not.toMatch(/passwd|boom/);
    expect(run.output[2]!.failure).toMatch(/404/);
    expect(run.detail).toBe("Read 1 of 3 homepages.");
  });
});

const rpcStub = () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return { data: name === "start_marketing_workflow" ? "wf1" : name === "save_competitor_scan" ? "scan1" : null, error: null };
  });
  return { rpc, calls };
};

describe("competitor research workflow", () => {
  it("reads your homepage and the named sites, saves each, and records the workflow", async () => {
    const { rpc, calls } = rpcStub();
    const out = await runCompetitorResearch({ rpc } as never, { orgId: "o1", ownWebsite: "https://joes-lawn.example", urls: ["plumber.example", "https://www.claims.example/", "plumber.example", "not a url", "down.example"] }, { fetchPage });
    expect(out.status).toBe("prepared");
    expect(out.read).toBe(2);
    const saves = calls.filter((c) => c.name === "save_competitor_scan").map((c) => [c.args.p_host, c.args.p_status, c.args.p_is_self]);
    expect(saves).toEqual([["joes-lawn.example", "done", true], ["plumber.example", "done", false], ["claims.example", "done", false], ["down.example", "failed", false]]);
    expect(out.failed.map((f) => f.host)).toEqual(expect.arrayContaining(["not a url", "down.example"]));
    expect(calls.find((c) => c.name === "finish_marketing_workflow")!.args).toMatchObject({ p_status: "prepared", p_provider: null });
  });

  it("does not compare your own site with itself", async () => {
    const { rpc, calls } = rpcStub();
    const out = await runCompetitorResearch({ rpc } as never, { orgId: "o1", ownWebsite: "https://plumber.example", urls: ["www.plumber.example"] }, { fetchPage });
    expect(out.status).toBe("failed");
    expect(out.reason).toMatch(/at least one website/);
    expect(calls.filter((c) => c.name === "save_competitor_scan")).toHaveLength(0);
  });

  it("fails plainly when nothing could be read or the limit is hit", async () => {
    const down = rpcStub();
    const a = await runCompetitorResearch({ rpc: down.rpc } as never, { orgId: "o1", ownWebsite: "https://joes-lawn.example", urls: ["down.example"] }, { fetchPage });
    expect(a).toMatchObject({ status: "failed", read: 0 });
    const rpc = vi.fn(async (name: string) => (name === "save_competitor_scan" ? { data: null, error: { message: "x", hint: "competitor_limit" } } : { data: "wf", error: null }));
    const b = await runCompetitorResearch({ rpc } as never, { orgId: "o1", ownWebsite: "https://joes-lawn.example", urls: ["plumber.example"] }, { fetchPage });
    expect(b).toMatchObject({ status: "failed", reason: expect.stringMatching(/up to 5/) });
  });
});

const card = (id: string, impact: string, evidence_class = "verified") => ({ id, title: `Fix ${id}`, why_it_matters: `Why ${id}`, recommended_action: `Do ${id}`, impact, evidence_class });
const base = (over: Partial<CampaignInput> = {}): CampaignInput => ({
  businessName: "Joe's Lawn", serviceArea: "Provo", primaryGoal: "more_calls", confirmedServices: [], cards: [], own: null, competitors: [], ...over,
});

describe("campaign playbooks", () => {
  it("offer nothing when nothing observed calls for a campaign", async () => {
    expect(planCampaigns(base({ serviceArea: "" }))).toEqual([]);
    const run = await MODULES.campaign_planning.run(base({ serviceArea: "" }));
    expect(run).toMatchObject({ status: "blocked" });
  });

  it("turn the most important open recommendations into tasks that point at them", () => {
    const [c] = planCampaigns(base({ serviceArea: "", cards: [card("a", "low"), card("b", "high"), card("c", "medium"), card("d", "high"), card("e", "low")] }));
    expect(c!.playbook).toBe("fix_first_impression");
    expect(c!.tasks.map((t) => t.card_id)).toEqual(["b", "d", "c", "a"]);
    expect(c!.tasks.every((t) => t.kind === "fix_action" && t.evidence_class === "verified")).toBe(true);
  });

  it("carry the card's evidence class, and a basis when it isn't verified", () => {
    const [c] = planCampaigns(base({ serviceArea: "", cards: [card("a", "high", "inferred")] }));
    expect(c!.tasks[0]).toMatchObject({ evidence_class: "inferred", basis: expect.any(String) });
  });

  it("close the gaps other sites show, naming who shows them and from what was observed", () => {
    const own = sig("thin-onepager.html");
    const camps = planCampaigns(base({ own, competitors: [{ host: "plumber.example", signals: sig("plumber.html") }] }));
    const m = camps.find((c) => c.playbook === "match_competitors")!;
    expect(m.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(["Add a tap-to-call phone link", "Add a line saying where you work"]));
    for (const t of m.tasks) {
      expect(t.evidence_class).toBe("verified");
      expect(t.why).toMatch(/plumber\.example .*Observed on public homepages, 1 of 1 compared/);
    }
    expect(m.tasks.find((t) => t.title.includes("where you work"))!.deliverable).toBe("Serving Provo.");
  });

  it("offer the review routine only when reviews are missing or a compared site shows them", () => {
    const withReviews = { ...sig("plumber.html"), reviews: true };
    expect(planCampaigns(base({ serviceArea: "", own: withReviews })).find((c) => c.playbook === "ask_for_reviews")).toBeUndefined();
    const r = planCampaigns(base({ serviceArea: "", own: sig("thin-onepager.html") })).find((c) => c.playbook === "ask_for_reviews")!;
    expect(r.tasks[0]).toMatchObject({ evidence_class: "verified" });
    const msg = r.tasks.find((t) => t.kind === "message")!;
    expect(msg.deliverable).toContain("[your review link]");
    expect(msg.deliverable).toContain("[your first name]");
    expect(msg.evidence_class).toBe("estimated");
    expect(msg.basis).toBeTruthy();
  });

  it("use only confirmed services in the profile description, and say so when there are none", () => {
    const none = planCampaigns(base()).find((c) => c.playbook === "google_profile")!;
    expect(none.tasks[1]).toMatchObject({ evidence_class: "unknown", deliverable: undefined });
    const some = planCampaigns(base({ confirmedServices: ["Lawn mowing", "Edging"] })).find((c) => c.playbook === "google_profile")!;
    expect(some.tasks[1]!.deliverable).toBe("Joe's Lawn serves Provo. We offer Lawn mowing, Edging. Call or message us to get started.");
    expect(some.tasks[1]!.evidence_class).toBe("verified");
    expect(some.tasks[0]!.evidence_class).toBe("unknown");
  });

  it("never promise results or invent numbers in any fixed text", () => {
    const text = JSON.stringify(planCampaigns(base({ own: sig("thin-onepager.html"), cards: [card("a", "high")], confirmedServices: ["Mowing"], competitors: [{ host: "plumber.example", signals: sig("plumber.html") }] })).map((c) => [c.title, c.summary, c.tasks.map((t) => [t.title, t.steps, t.deliverable])]));
    expect(text).not.toMatch(/guarantee|#1|number one|best |award|\b\d+%|double your|triple/i);
  });

  it("every task satisfies the database rule: anything not verified has a basis", () => {
    const all = planCampaigns(base({ own: sig("thin-onepager.html"), cards: [card("a", "high", "estimated")], competitors: [{ host: "p.example", signals: sig("plumber.html") }] }));
    for (const t of all.flatMap((c) => c.tasks)) expect(t.evidence_class === "verified" || !!t.basis, t.title).toBe(true);
    for (const t of all.flatMap((c) => c.tasks)) expect(t.title.length <= 160 && t.why.length <= 500 && t.steps.length <= 8 && (t.deliverable ?? "").length <= 4000).toBe(true);
  });

  it("is deterministic", () => {
    const i = base({ own: sig("thin-onepager.html"), cards: [card("a", "high")] });
    expect(planCampaigns(i)).toEqual(planCampaigns(i));
  });
});

describe("campaign planning workflow", () => {
  it("saves each proposed campaign through the checked database function and records the run", async () => {
    const { rpc, calls } = rpcStub();
    const out = await runCampaignPlanning({ rpc } as never, { orgId: "o1", campaign: base({ cards: [card("a", "high")] }) });
    expect(out).toMatchObject({ status: "prepared", saved: 2 });
    const saves = calls.filter((c) => c.name === "save_campaign");
    expect(saves.map((s) => (s.args.p_campaign as { playbook: string }).playbook)).toEqual(["fix_first_impression", "google_profile"]);
    expect(calls.find((c) => c.name === "finish_marketing_workflow")!.args).toMatchObject({ p_status: "prepared" });
  });

  it("records a blocked run with the reason when nothing calls for a campaign", async () => {
    const { rpc, calls } = rpcStub();
    const out = await runCampaignPlanning({ rpc } as never, { orgId: "o1", campaign: base({ serviceArea: "" }) });
    expect(out.status).toBe("blocked");
    expect(calls.some((c) => c.name === "save_campaign")).toBe(false);
    expect(calls.find((c) => c.name === "finish_marketing_workflow")!.args).toMatchObject({ p_status: "blocked" });
  });

  it("reports a failure if no campaign could be saved", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "start_marketing_workflow" ? "wf" : null, error: name === "save_campaign" ? { message: "no" } : null }));
    expect(await runCampaignPlanning({ rpc } as never, { orgId: "o1", campaign: base({ cards: [card("a", "high")] }) })).toMatchObject({ status: "failed", saved: 0 });
  });
});

describe("campaign results", () => {
  it("counts finished tasks and what the next website check verified", () => {
    const r = campaignResults(
      [{ status: "done", card_id: "a" }, { status: "done", card_id: "b" }, { status: "skipped", card_id: null }, { status: "approved", card_id: "c" }],
      new Map([["a", { verification: "fixed" }], ["b", { verification: "still_found" }], ["c", { verification: null }]]),
    );
    expect(r).toEqual({ total: 4, done: 2, skipped: 1, open: 1, fixesLinked: 3, verifiedFixed: 1, stillFound: 1, awaitingCheck: 1 });
  });
});
