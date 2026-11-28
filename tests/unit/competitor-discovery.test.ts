/**
 * Competitor discovery: parsing, filtering, ranking and honesty rules, against hand-written sample responses in the shape of the
 * sources' real ones. The samples prove OUR handling only; whether the sources return good competitors is checked live, not here.
 */
import { describe, expect, it } from "vitest";

import { discoverCompetitors, fixedHostGet, parseSearchResults, searchQueries, servicePhrase } from "@/lib/server/agent/modules/competitor-discovery";

const ddg = (rows: { href: string; title: string; snippet: string; ad?: boolean }[]) =>
  `<html><body>${rows.map((r) => `<div class="result ${r.ad ? "result--ad" : ""}"><h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.href)}&rut=x">${r.title}</a></h2><a class="result__snippet">${r.snippet}</a></div>`).join("")}</body></html>`;

const nominatim = JSON.stringify([{ lat: "30.2672", lon: "-97.7431", display_name: "Austin, Travis County, Texas, United States" }]);
const overpass = JSON.stringify({ elements: [
  { type: "node", id: 11, lat: 30.27, lon: -97.74, tags: { name: "Lone Star Plumbing", craft: "plumber", website: "https://www.lonestarplumbing.example/contact" } },
  { type: "way", id: 12, center: { lat: 30.4, lon: -97.7 }, tags: { name: "Capital Pipe Co", craft: "plumber", website: "capitalpipe.example" } },
  { type: "node", id: 13, lat: 30.3, lon: -97.8, tags: { name: "No Site Plumbing", craft: "plumber" } },
  { type: "node", id: 14, lat: 30.3, lon: -97.8, tags: { name: "Directory Entry", craft: "plumber", website: "https://www.yelp.com/biz/x" } },
] });

const input = { ownWebsite: "https://www.ourplumbing.example/", serviceArea: "Austin, TX", services: ["Emergency drain cleaning", "Water heater repair"] };

/** A fake network keyed by what the URL contains; records every URL asked for. */
const net = (routes: [string, string | Error][]) => {
  const asked: string[] = [];
  return { asked, get: async (url: string) => { asked.push(url); const r = routes.find(([k]) => url.includes(k)); if (!r) throw new Error("no route"); if (r[1] instanceof Error) throw r[1]; return r[1]; }, sleep: async () => {} };
};

describe("search results", () => {
  it("parses real-shaped result links, unwraps the redirect, skips ads, keeps position and snippet", () => {
    const hits = parseSearchResults(ddg([
      { href: "https://ad.example/", title: "Sponsored", snippet: "buy", ad: true },
      { href: "https://www.alpha-plumbing.example/", title: "Alpha Plumbing", snippet: "Drain cleaning in Austin" },
      { href: "https://beta.example/about", title: "Beta", snippet: "" },
    ]));
    expect(hits.map((h) => [h.position, h.url])).toEqual([[1, "https://www.alpha-plumbing.example/"], [2, "https://beta.example/about"]]);
    expect(hits[0]).toMatchObject({ title: "Alpha Plumbing", snippet: "Drain cleaning in Austin" });
    expect(hits[1]!.snippet).toBeNull();
  });
  it("ignores garbage", () => expect(parseSearchResults("<html>nothing</html>")).toEqual([]));
});

describe("queries use only a place and a short service phrase, never the business name", () => {
  it("builds at most two short phrases", () => {
    expect(servicePhrase("Emergency drain cleaning & rooter service for homes!")).toBe("emergency drain cleaning rooter");
    expect(searchQueries(["Emergency drain cleaning", "Water heater repair", "Third"], "Austin, TX")).toEqual(["emergency drain cleaning Austin, TX", "water heater repair Austin, TX"]);
    expect(searchQueries(["a"], "Austin")).toEqual([]);
  });
});

describe("discoverCompetitors", () => {
  it("combines map listings and search hits, drops directories, the owner's own site and sites already compared, and ranks agreement highest", async () => {
    const n = net([
      ["nominatim", nominatim], ["interpreter", overpass],
      ["duckduckgo.com/html", ddg([
        { href: "https://www.lonestarplumbing.example/", title: "Lone Star Plumbing - Austin", snippet: "Drain cleaning" },
        { href: "https://www.yelp.com/search?find_desc=plumber", title: "Best plumbers - Yelp", snippet: "" },
        { href: "https://www.ourplumbing.example/", title: "Us", snippet: "" },
        { href: "https://dripfix.example/", title: "Drip Fix", snippet: "Water heaters" },
        { href: "https://already.example/", title: "Already", snippet: "" },
      ])],
    ]);
    const r = await discoverCompetitors({ ...input, alreadyComparing: ["already.example"] }, n);
    // (the stand-in answers both searches with the same page, so Drip Fix appears in two searches and outranks one map-only listing)
    expect(r.candidates.map((c) => c.host)).toEqual(["lonestarplumbing.example", "dripfix.example", "capitalpipe.example"]);
    const first = r.candidates[0]!;
    expect([...new Set(first.sources.map((s) => s.kind))].sort()).toEqual(["openstreetmap", "web_search"]); // in both: ranked first
    expect(first.url).toBe("https://www.lonestarplumbing.example/"); // origin only, as the site published it
    expect(first.evidence_class).toBe("inferred");
    expect(first.basis).toMatch(/OpenStreetMap/);
    expect(first.basis).toMatch(/public web search/);
    expect(r.attribution).toEqual(["Map data © OpenStreetMap contributors (ODbL)"]);
    expect(r.limits.join(" ")).toMatch(/not proof they compete/);
    expect(r.sourceStatus.map((s) => [s.source, s.status])).toEqual([["openstreetmap", "ok"], ["web_search", "ok"]]);
    expect(r.queries).toMatchObject({ osmKind: "plumbers", search: ["emergency drain cleaning Austin, TX", "water heater repair Austin, TX"] });
  });

  it("sends only a place and a service phrase out: never the business name, email or own address", async () => {
    const n = net([["nominatim", nominatim], ["interpreter", overpass], ["duckduckgo.com/html", ddg([])]]);
    await discoverCompetitors(input, n);
    const sent = decodeURIComponent(n.asked.join("\n"));
    expect(sent).not.toMatch(/ourplumbing/i);
    expect(n.asked.every((u) => /^https:\/\/(nominatim\.openstreetmap\.org|overpass[^/]*|html\.duckduckgo\.com)\//.test(u))).toBe(true);
  });

  it("works from search alone when the services have no reliable map category, and says so", async () => {
    const n = net([["duckduckgo.com/html", ddg([{ href: "https://x-media.example/", title: "X", snippet: "" }])]]);
    const r = await discoverCompetitors({ ...input, services: ["Brand strategy workshops"] }, n);
    expect(r.candidates.map((c) => c.host)).toEqual(["x-media.example"]);
    expect(r.sourceStatus[0]).toMatchObject({ source: "openstreetmap", status: "skipped" });
    expect(n.asked.some((u) => u.includes("overpass") || u.includes("nominatim"))).toBe(false);
  });

  it("a failing source is reported as failed, not hidden, and the other still answers; all failing yields no invented results", async () => {
    const half = await discoverCompetitors(input, net([["nominatim", new Error("status_503")], ["duckduckgo.com/html", ddg([{ href: "https://dripfix.example/", title: "Drip Fix", snippet: "" }])]]));
    expect(half.sourceStatus.find((s) => s.source === "openstreetmap")).toMatchObject({ status: "failed" });
    expect(half.candidates.map((c) => c.host)).toEqual(["dripfix.example"]);
    const none = await discoverCompetitors(input, net([["nominatim", new Error("x")], ["duckduckgo.com/html", new Error("x")]]));
    expect(none.candidates).toEqual([]);
    expect(none.sourceStatus.map((s) => s.status)).toEqual(["failed", "failed"]);
  });

  it("does nothing, and says why, without a place or without services", async () => {
    const n = net([]);
    const a = await discoverCompetitors({ ...input, serviceArea: null }, n);
    const b = await discoverCompetitors({ ...input, services: [] }, n);
    expect(a.candidates).toEqual([]);
    expect(a.sourceStatus[0]!.note).toMatch(/service area/i);
    expect(b.sourceStatus[0]!.status).toBe("skipped");
    expect(n.asked).toEqual([]);
  });
});

describe("web search can be switched off", () => {
  it("uses map listings only and never contacts the search host", async () => {
    const n = net([["nominatim", nominatim], ["interpreter", overpass]]);
    const r = await discoverCompetitors({ ...input, webSearch: false }, n);
    expect(n.asked.some((u) => u.includes("duckduckgo"))).toBe(false);
    expect(r.candidates.map((c) => c.host)).toEqual(["lonestarplumbing.example", "capitalpipe.example"]);
    expect(r.sourceStatus.find((s) => s.source === "web_search")).toMatchObject({ status: "skipped", note: expect.stringMatching(/switched off/) });
  });
});

describe("a search service that pushes back", () => {
  const challenge = "<html><body><div class='anomaly-modal'>Unfortunately, bots use DuckDuckGo too.</div></body></html>";
  it("retries once after a pause when it gets the challenge page, then uses the real results", async () => {
    let calls = 0;
    const slept: number[] = [];
    const get = async (url: string) => { if (url.includes("nominatim")) return nominatim; if (url.includes("interpreter")) return overpass; return calls++ === 0 ? challenge : ddg([{ href: "https://dripfix.example/", title: "Drip Fix", snippet: "" }]); };
    const r = await discoverCompetitors({ ...input, services: ["Brand strategy workshops"] }, { get, sleep: async (ms) => { slept.push(ms); } });
    expect(r.candidates.map((c) => c.host)).toEqual(["dripfix.example"]);
    expect(Math.max(...slept)).toBeGreaterThanOrEqual(6_000);
  });
  it("reports 'asked us to slow down' (not a vague failure, not made-up results) when it keeps pushing back", async () => {
    const r = await discoverCompetitors({ ...input, services: ["Brand strategy workshops"] }, { get: async () => challenge, sleep: async () => {} });
    expect(r.candidates).toEqual([]);
    expect(r.sourceStatus.find((s) => s.source === "web_search")).toMatchObject({ status: "failed", note: expect.stringMatching(/slow down/) });
  });
});

describe("the real fetcher only ever talks to its fixed hosts", () => {
  it("refuses any other host, scheme or address", async () => {
    for (const u of ["https://evil.example/x", "http://nominatim.openstreetmap.org/search", "https://169.254.169.254/latest", "https://nominatim.openstreetmap.org.evil.example/"]) {
      await expect(fixedHostGet(u)).rejects.toThrow("host_not_allowed");
    }
  });
});
