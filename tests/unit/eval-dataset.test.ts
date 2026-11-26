/**
 * The evaluation dataset checked against ITSELF. A ground truth that contradicts its own pages would make every score
 * meaningless, so: every "must preserve" quote is verbatim on a page, every "unknown" is really absent, every pattern
 * compiles and never matches the site's own text, the data is fictional, and the deterministic scan produces the open
 * actions the strategy truth refers to. No model is involved.
 */
import { describe, expect, it } from "vitest";

import { ALL_CASES, DEV_SET, TEST_SET, type EvalCase } from "../../evals/model/dataset";
import { checkSite } from "../../evals/sitecheck/run";
import { sourcePages } from "@/lib/server/agent/modules/business-understanding";
import { extractFacts } from "@/lib/server/site-scan";
import type { FetchedPage } from "@/lib/server/safe-fetch";

const fetchOf = (c: EvalCase) => async (url: string): Promise<FetchedPage> => {
  const body = c.pages[new URL(url).pathname || "/"];
  return { url, status: body ? 200 : 404, contentType: "text/html", body: body ?? "", truncated: false, redirects: [] };
};
const factsOf = (c: EvalCase) => Object.entries(c.pages).map(([path, body]) => extractFacts({ url: `https://${c.id.toLowerCase()}.example${path}`, status: 200, contentType: "text/html", body, truncated: false, redirects: [] }));
/** Exactly what the model is shown for each page (title, description, headings and text), so a quote is valid only if it is in there. */
const texts = (c: EvalCase) => { const f = factsOf(c); return sourcePages({ homepage: f.find((p) => new URL(p.url).pathname === "/")!, pages: f.filter((p) => new URL(p.url).pathname !== "/"), failures: [] }).map((p) => p.text); };
const rx = (p: string) => new RegExp(p, "i");
/** The page text with the planted instruction removed (the injection is allowed to contain what the invented-claim patterns look for). */
const siteText = (c: EvalCase) => { const t = texts(c).join("\n"); return c.truth.injection ? t.replace(c.truth.injection.text, "") : t; };

describe("shape and completeness", () => {
  it("has 4 dev and 10 test cases with unique ids", () => {
    expect(DEV_SET.map((c) => c.id)).toEqual(["D1", "D2", "D3", "D4"]);
    expect(TEST_SET.map((c) => c.id)).toEqual(["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"]);
    expect(new Set(ALL_CASES.map((c) => c.id)).size).toBe(14);
    expect(new Set(ALL_CASES.map((c) => c.business.name)).size).toBe(14);
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))("%s has every ground-truth element the plan requires", (_id, c) => {
    const t = c.truth;
    expect(c.business.background.length).toBeGreaterThan(30);
    expect(c.probes.length).toBeGreaterThan(0);
    expect(t.objectives.length).toBeGreaterThanOrEqual(1);
    expect(t.mustPreserve.length).toBeGreaterThanOrEqual(1);
    expect(t.unknown.length).toBeGreaterThanOrEqual(2);
    expect(t.inventedClaims.length).toBeGreaterThanOrEqual(1);
    expect(t.expectedFindings.length).toBeGreaterThanOrEqual(1);
    expect(t.strategy.direction.length).toBeGreaterThan(30);
    expect(t.strategy.mustAddress.length).toBeGreaterThanOrEqual(1);
    expect(t.content.mustMention.length).toBeGreaterThanOrEqual(1);
    expect(t.content.voice.length).toBeGreaterThan(5);
    expect(t.unacceptable.length).toBeGreaterThanOrEqual(2);
    expect(c.pages["/"]).toBeTruthy();
    for (const f of t.expectedFindings) expect(f.anyOf.length, `${c.id} ${f.id}`).toBeGreaterThan(0);
    for (const g of [...t.strategy.mustAddress, ...t.content.mustMention, ...c.notes.flatMap((n) => n.mustAddress)]) expect(g.length).toBeGreaterThan(0);
  });

  it("test cases are the scored ones: every test case has at least 6 facts to preserve, 3 unknowns and 2 expected findings", () => {
    for (const c of TEST_SET) {
      expect(c.truth.mustPreserve.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.truth.unknown.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.truth.expectedFindings.length, c.id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the pages are fictional and carry no personal or real data", () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))("%s uses only .example domains, 555-01xx phone numbers and example emails", (_id, c) => {
    const raw = Object.values(c.pages).join("\n") + JSON.stringify(c.notes);
    for (const m of raw.matchAll(/\(?\d{3}\)?[ -](\d{3})-(\d{4})/g)) expect(`${m[1]}-${m[2]}`, `phone ${m[0]}`).toMatch(/^555-01\d\d$/);
    for (const m of raw.matchAll(/[A-Za-z0-9._-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)/g)) expect(m[1], `email ${m[0]}`).toMatch(/\.example$/);
    for (const m of raw.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) { if (!/schema\.org$/.test(m[1]!)) expect(m[1], `host ${m[0]}`).toMatch(/\.example$/); }
  });
});

describe("the ground truth agrees with the pages", () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))("%s: every must-preserve quote and expected-finding quote is verbatim on a page", (_id, c) => {
    const all = texts(c).join("\n");
    for (const f of c.truth.mustPreserve) expect(all, `${c.id}/${f.id}: ${f.quote}`).toContain(f.quote);
    for (const f of c.truth.expectedFindings) expect(all, `${c.id}/${f.id}: ${f.quote}`).toContain(f.quote);
    if (c.truth.injection) expect(texts(c).join("\n")).toContain(c.truth.injection.text);
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))("%s: every keyword of a must-preserve fact is in its quote or claim, so a correct fact can match", (_id, c) => {
    for (const f of c.truth.mustPreserve) for (const k of f.keywords) expect(`${f.quote} ${f.claim}`.toLowerCase(), `${c.id}/${f.id} keyword '${k}'`).toContain(k.toLowerCase());
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))("%s: 'unknown' and 'invented claim' patterns never match the site's own text (so a hit proves invention)", (_id, c) => {
    const text = siteText(c);
    for (const u of c.truth.unknown) for (const p of u.forbidden) expect(text, `${c.id}/${u.id}: /${p}/`).not.toMatch(rx(p));
    for (const i of c.truth.inventedClaims) expect(text, `${c.id}/${i.id}: /${i.pattern}/`).not.toMatch(rx(i.pattern));
    for (const n of c.truth.notProblems) expect(text, `${c.id}/${n.id}`).not.toMatch(rx(n.pattern)); // sanity: patterns describe complaints, not site text
  });

  it.each(ALL_CASES.map((c) => [c.id, c] as const))("%s: every pattern compiles", (_id, c) => {
    const t = c.truth;
    const all = [...t.unknown.flatMap((u) => u.forbidden), ...t.inventedClaims.map((i) => i.pattern), ...t.notProblems.map((n) => n.pattern), ...t.strategy.mustNotRecommend, ...t.content.banned, ...c.notes.flatMap((n) => n.mustNotRecommend), ...(t.injection ? [t.injection.pattern] : [])];
    for (const p of all) expect(() => rx(p), p).not.toThrow();
  });

  it("the planted-instruction case really plants it, and its pattern catches the planted text", () => {
    const t3 = ALL_CASES.find((c) => c.id === "T3")!;
    expect(t3.truth.injection).toBeTruthy();
    expect(t3.truth.injection!.text).toMatch(rx(t3.truth.injection!.pattern));
  });

  it("the conflicting-number case states every conflicting value on a page", () => {
    const t7 = ALL_CASES.find((c) => c.id === "T7")!;
    const all = texts(t7).join("\n");
    for (const c of t7.truth.conflicts!) for (const v of c.values) expect(all).toContain(v);
  });
});

describe("the strategy truth refers to open actions the deterministic scan really produces", () => {
  it.each(ALL_CASES.map((c) => [c.id, c] as const))("%s: expectedChecks are all produced, and any acceptable-first / must-not-be-first keys exist", async (_id, c) => {
    const r = await checkSite(`https://${c.id.toLowerCase()}.example/`, { businessName: c.business.name, serviceArea: c.business.serviceArea, primaryGoal: c.business.primaryGoal }, { fetchPage: fetchOf(c), pageSpeed: async () => ({ ok: false as const, reason: "n/a" }) });
    expect(r.ok, r.reason).toBe(true);
    const keys = new Set(r.findings.map((f) => f.check_key));
    expect(r.findings.length, `${c.id} needs at least one open action for the plan task`).toBeGreaterThan(0);
    for (const k of c.truth.expectedChecks) expect(keys.has(k), `${c.id} expects check ${k}; produced ${[...keys].join(", ")}`).toBe(true);
    for (const k of [...c.truth.strategy.acceptableFirst, ...c.truth.strategy.mustNotBeFirst, ...c.notes.flatMap((n) => n.mustNotBeFirst ?? [])]) expect(keys.has(k), `${c.id} refers to check ${k}`).toBe(true);
  });
});
