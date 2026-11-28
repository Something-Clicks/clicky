/**
 * The free-tier governor: pacing arithmetic, daily allowance, resume times and the parsing of Groq's limit messages.
 * Pure: a fake clock stands in for time. No network and no model. Limits tested are Groq's published Free Plan numbers
 * for openai/gpt-oss-120b (30 RPM, 1K RPD, 8K TPM, 200K TPD); the governor keeps 10% under each.
 */
import { describe, expect, it } from "vitest";

import { ModelThrottled } from "@/lib/server/agent/provider";
import { FREE_TIER_LIMITS, Governor, parseDuration, parseLimitHit, resumeSentence, type Clock, type GovernorState } from "@/lib/server/agent/providers/groq-limits";

const clockAt = (start = 1_000_000): Clock & { t: number; slept: number[] } => {
  const c = { t: start, slept: [] as number[], now: () => c.t, sleep: async (ms: number) => { c.slept.push(ms); c.t += ms; } };
  return c;
};

describe("limits", () => {
  it("are Groq's Free Plan numbers for the three structured-output models", () => {
    expect(FREE_TIER_LIMITS).toEqual({ rpm: 30, tpm: 8_000, rpd: 1_000, tpd: 200_000 });
  });
});

describe("minute pacing", () => {
  it("lets requests through while they fit, then waits for the oldest spend to leave the rolling minute", async () => {
    const clock = clockAt();
    const g = new Governor(FREE_TIER_LIMITS, clock);
    // 90% of 8000 = 7200 tokens per minute: two 3,000-token requests fit, a third has to wait for the first to age out.
    g.settle(await g.acquire(3_000, 0), 3_000);
    clock.t += 10_000;
    g.settle(await g.acquire(3_000, 0), 3_000);
    clock.t += 10_000;
    const third = g.acquire(3_000, 120_000);
    const lease = await third;
    expect(lease.tokens).toBe(3_000);
    // The first spend was at t0 and leaves the minute at t0+60s; we were at t0+20s, so we waited about 40s.
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(40_000);
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBeLessThan(41_000);
  });

  it("ends with ModelThrottled('minute') carrying the exact resume time when the wait is longer than allowed", async () => {
    const clock = clockAt();
    const g = new Governor(FREE_TIER_LIMITS, clock);
    g.settle(await g.acquire(7_000, 0), 7_000);
    clock.t += 5_000;
    const err = await g.acquire(2_000, 10_000).catch((e) => e);
    expect(err).toBeInstanceOf(ModelThrottled);
    expect(err).toMatchObject({ kind: "minute", status: 429 });
    expect(err.resumeAt).toBe(1_000_000 + 60_000);
    expect(err.retryAfterMs).toBe(55_000);
  });

  it("counts requests as well as tokens (30 per minute, 27 kept)", async () => {
    const clock = clockAt();
    const g = new Governor(FREE_TIER_LIMITS, clock);
    for (let i = 0; i < 27; i++) g.settle(await g.acquire(10, 0), 10);
    const err = await g.acquire(10, 0).catch((e) => e);
    expect(err).toMatchObject({ kind: "minute" });
  });

  it("holds a reservation until settled, so parallel requests cannot together overrun the minute", async () => {
    const g = new Governor(FREE_TIER_LIMITS, clockAt());
    const first = await g.acquire(4_000, 0);
    await expect(g.acquire(4_000, 0)).rejects.toMatchObject({ kind: "minute" });
    g.settle(first, 4_000);
  });
});

describe("a request that can never fit", () => {
  it("is refused as too_large, and the output allowance is clamped to what fits", async () => {
    const g = new Governor(FREE_TIER_LIMITS, clockAt());
    await expect(g.acquire(8_000, 0)).rejects.toMatchObject({ kind: "too_large" });
    expect(g.clampOutput(2_000, 16_000)).toBe(7_200 - 2_000 - 50);
    expect(g.clampOutput(2_000, 1_500)).toBe(1_500);
    expect(g.clampOutput(6_900, 1_500)).toBeNull(); // not even a short answer fits
    expect(g.clampOutput(6_900, 300)).toBeNull();
  });
});

describe("the daily allowance", () => {
  it("is never waited out: it ends as ModelThrottled('day') with the time the oldest spend ages out of the rolling day", async () => {
    const clock = clockAt();
    const g = new Governor({ ...FREE_TIER_LIMITS, tpm: 1_000_000 }, clock);
    // 180,000 is 90% of 200,000.
    g.settle(await g.acquire(100_000, 0), 100_000);
    clock.t += 3_600_000;
    g.settle(await g.acquire(80_000, 0), 80_000);
    clock.t += 60_000;
    const err = await g.acquire(10_000, 0).catch((e) => e);
    expect(err).toMatchObject({ kind: "day", status: 429 });
    // The 100,000 spend (t0) leaves the day at t0 + 24h.
    expect(err.resumeAt).toBe(1_000_000 + 86_400_000);
    // And once that time has passed the request goes through.
    clock.t = err.resumeAt + 1;
    await expect(g.acquire(10_000, 0)).resolves.toBeTruthy();
  });

  it("counts a settled call at what Groq reported, and an unsent one (0) not at all", async () => {
    const g = new Governor(FREE_TIER_LIMITS, clockAt());
    g.settle(await g.acquire(5_000, 0), 1_200);
    g.settle(await g.acquire(5_000, 0), 0);
    expect(g.usage()).toMatchObject({ dayTokens: 1_200, minuteTokens: 1_200 });
  });
});

describe("what Groq itself says", () => {
  it("headers about the remaining minute allowance are honoured (another process may be using the key)", async () => {
    const clock = clockAt();
    const g = new Governor(FREE_TIER_LIMITS, clock);
    g.observe({ remainingTokens: 500 });
    const err = await g.acquire(2_000, 1_000).catch((e) => e);
    expect(err).toMatchObject({ kind: "minute" });
  });

  it("a stated retry time blocks sending until then", async () => {
    const clock = clockAt();
    const g = new Governor(FREE_TIER_LIMITS, clock);
    g.blockFor(20_000);
    const lease = await g.acquire(500, 60_000);
    expect(lease.tokens).toBe(500);
    expect(clock.slept.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(20_000);
  });

  it("parses durations Groq writes", () => {
    expect(parseDuration("7.5s")).toBe(7_500);
    expect(parseDuration("2m")).toBe(120_000);
    expect(parseDuration("1h2m3s")).toBe(3_723_000);
    expect(parseDuration("850ms")).toBe(850);
    expect(parseDuration("1m26.4s")).toBe(86_400);
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration(null)).toBeNull();
  });

  it("tells a minute limit from a day limit and reads the wait, from numbers and unit names only", () => {
    expect(parseLimitHit("Rate limit reached for model x on tokens per minute (TPM): Limit 8000, Used 7000, Requested 2000. Please try again in 7.5s.", null)).toEqual({ kind: "minute", unit: "tokens", waitMs: 7_500 });
    expect(parseLimitHit("... on tokens per day (TPD): Limit 200000 ... Please try again in 1h2m3s. Need more", null)).toEqual({ kind: "day", unit: "tokens", waitMs: 3_723_000 });
    expect(parseLimitHit("... on requests per day (RPD): Limit 1000 ... try again in 12m0s", null)).toMatchObject({ kind: "day", unit: "requests", waitMs: 720_000 });
    expect(parseLimitHit("{}", "4")).toEqual({ kind: "minute", unit: "tokens", waitMs: 4_000 });
    expect(parseLimitHit("", null).waitMs).toBeNull();
  });

  it("says when work can resume in plain words", () => {
    expect(resumeSentence(1_000_000 + 30_000, 1_000_000)).toBe("in about a minute");
    expect(resumeSentence(1_000_000 + 10 * 60_000, 1_000_000)).toBe("in about 10 minutes");
    expect(resumeSentence(Date.UTC(2026, 10, 29, 3, 15), Date.UTC(2026, 10, 28, 20, 0))).toBe("around 03:15 UTC (about 8 hours from now)");
  });
});

describe("state shared between runs", () => {
  it("is saved after settling and restored by the next Governor (the evaluation spans days)", async () => {
    let saved: GovernorState | null = null;
    const store = { load: () => saved, save: (s: GovernorState) => { saved = JSON.parse(JSON.stringify(s)); } };
    const clock = clockAt();
    const a = new Governor(FREE_TIER_LIMITS, clock, store);
    a.settle(await a.acquire(6_000, 0), 6_000);
    const b = new Governor(FREE_TIER_LIMITS, clock, store);
    expect(b.usage().dayTokens).toBe(6_000);
    await expect(b.acquire(3_000, 0)).rejects.toMatchObject({ kind: "minute" });
  });
});
