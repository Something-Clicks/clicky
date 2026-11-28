/**
 * Live check of competitor discovery against the real sources (OpenStreetMap, DuckDuckGo). Opt-in, network needed, no key, no customer data:
 *   DISCOVERY_AREA="Austin, TX" DISCOVERY_SERVICES="drain cleaning,water heater repair" pnpm sitecheck evals/sitecheck/discovery.eval.ts
 * Prints what each source returned and each candidate with its sources, so a person can judge the results.
 */
import { describe, expect, it } from "vitest";

import { discoverCompetitors } from "@/lib/server/agent/modules/competitor-discovery";

const area = process.env.DISCOVERY_AREA;
describe.skipIf(!area)("competitor discovery against the real sources", () => {
  it("returns candidates with sources, or a plain reason", async () => {
    const r = await discoverCompetitors({ ownWebsite: process.env.DISCOVERY_OWN ?? "https://own.example/", serviceArea: area!, services: (process.env.DISCOVERY_SERVICES ?? "plumbing").split(",").map((s) => s.trim()) });
    console.log(JSON.stringify({ queries: r.queries, sourceStatus: r.sourceStatus, candidates: r.candidates.map((c) => ({ host: c.host, name: c.name, score: c.score, basis: c.basis })) }, null, 1));
    expect(r.sourceStatus.length).toBeGreaterThan(0);
  }, 120_000);
});
