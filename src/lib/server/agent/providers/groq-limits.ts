/**
 * Free-tier limits for Groq: pacing, daily allowance and plain "when can this resume" answers.
 *
 * Owner decision (Nov 28 2026): Groq's FREE tier only. No payment method, no paid inference, no automatic switch to a paid model.
 * Groq's published Free Plan table (console.groq.com/docs/rate-limits, read Nov 28 2026) gives openai/gpt-oss-120b,
 * openai/gpt-oss-20b and qwen/qwen3.8-27b the same limits: 30 requests/minute (RPM), 1,000 requests/day (RPD), 8,000 tokens/minute
 * (TPM) and 200,000 tokens/day (TPD). Live response headers confirmed RPD 1000 and TPM 8000. Groq counts a request's INPUT tokens
 * plus its requested `max_completion_tokens` against TPM when the request is made, so one request must fit under 8,000 in total.
 *
 * The governor is deliberately conservative and in-process: it keeps a rolling minute and a rolling day of what THIS process sent
 * (optionally mirrored to a small state file so separate runs of the evaluation share one day), and it learns what other
 * processes used from Groq's own headers. Groq's 429 stays the final authority: it is parsed, never ignored.
 * Pure of network and timers (clock and sleep are injected), so the arithmetic is tested exactly.
 */
import { ModelThrottled } from "../provider";

export interface GroqLimits { rpm: number; tpm: number; rpd: number; tpd: number }

/** Groq's Free Plan for the three structured-output models (see above). Overridable per variable, never raised silently. */
export const FREE_TIER_LIMITS: GroqLimits = { rpm: 30, tpm: 8_000, rpd: 1_000, tpd: 200_000 };

/** Stay a little under each ceiling: Groq counts differently from our estimate, and a shared key may have other users. */
const MARGIN = 0.9;
/** The least output worth asking for. Below this a structured answer cannot be complete, so the request is refused as too large. */
export const MIN_OUTPUT_TOKENS = 600;
const MINUTE = 60_000;
const DAY = 86_400_000;

export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)) };

interface Spend { t: number; tokens: number }
export interface Lease { id: number; tokens: number }

export interface GovernorState { minute: Spend[]; day: Spend[]; blockedUntil: number; remainingTokens: number | null; remainingAt: number }

export interface StateStore { load(): GovernorState | null; save(s: GovernorState): void }

/** Rolling-window pacer for one model on one key. */
export class Governor {
  private minute: Spend[] = [];
  private day: Spend[] = [];
  private leases = new Map<number, Spend>();
  private nextId = 1;
  /** Groq told us (429 or headers) not to send before this time. */
  private blockedUntil = 0;
  /** Tokens Groq said remain in the minute window, and when it said so (covers other processes using the key). */
  private remainingTokens: number | null = null;
  private remainingAt = 0;
  private readonly limits: GroqLimits;

  constructor(limits: GroqLimits = FREE_TIER_LIMITS, private readonly clock: Clock = realClock, private readonly store: StateStore | null = null) {
    this.limits = { rpm: Math.max(1, Math.floor(limits.rpm * MARGIN)), tpm: Math.floor(limits.tpm * MARGIN), rpd: Math.max(1, Math.floor(limits.rpd * MARGIN)), tpd: Math.floor(limits.tpd * MARGIN) };
    const saved = store?.load();
    if (saved) {
      this.minute = saved.minute; this.day = saved.day; this.blockedUntil = saved.blockedUntil;
      this.remainingTokens = saved.remainingTokens; this.remainingAt = saved.remainingAt;
    }
  }

  /** The most a single request may use (input plus requested output) so that it can ever be sent. */
  get requestCeiling() { return this.limits.tpm; }

  private trim(now: number) {
    this.minute = this.minute.filter((s) => now - s.t < MINUTE);
    this.day = this.day.filter((s) => now - s.t < DAY);
  }

  private persist() {
    this.store?.save({ minute: this.minute, day: this.day, blockedUntil: this.blockedUntil, remainingTokens: this.remainingTokens, remainingAt: this.remainingAt });
  }

  /** Output allowance that fits under TPM for this input, or null when even the smallest useful answer would not fit. */
  clampOutput(estInputTokens: number, wantedOutput: number): number | null {
    const room = this.limits.tpm - estInputTokens - 50;
    const out = Math.min(wantedOutput, room);
    return out >= Math.min(MIN_OUTPUT_TOKENS, wantedOutput) ? out : null;
  }

  /** When (epoch ms) a request of `tokens` can first be sent, given the rolling windows; `null` if it can never fit the limits. */
  private earliest(tokens: number, now: number): { at: number; kind: "minute" | "day" } | null {
    if (tokens > this.limits.tpm || tokens > this.limits.tpd) return null;
    let at = now;
    let kind: "minute" | "day" = "minute";
    if (this.blockedUntil > at) at = this.blockedUntil;
    // Minute windows: wait until enough older spend has aged out of the rolling minute.
    let tok = this.minute.reduce((n, s) => n + s.tokens, 0) + [...this.leases.values()].reduce((n, s) => n + s.tokens, 0);
    let req = this.minute.length + this.leases.size;
    if (this.remainingTokens !== null && now - this.remainingAt < MINUTE) tok = Math.max(tok, this.limits.tpm - this.remainingTokens);
    const headerDeficit = this.remainingTokens !== null && now - this.remainingAt < MINUTE ? this.limits.tpm - this.remainingTokens : 0;
    const aging = [...this.minute].sort((a, b) => a.t - b.t);
    for (const s of aging) {
      if (tok + tokens <= this.limits.tpm && req + 1 <= this.limits.rpm) break;
      tok -= s.tokens; req -= 1; at = Math.max(at, s.t + MINUTE);
    }
    if (tok + tokens > this.limits.tpm || req + 1 > this.limits.rpm) {
      // What is left over is not ours to age out: Groq's header says the minute is spent elsewhere (it refills a minute after it
      // said so), or another request of ours is still in flight (look again shortly, after it settles).
      at = Math.max(at, headerDeficit > 0 && tok - headerDeficit <= 0 ? this.remainingAt + MINUTE : now + 1_000);
    }
    // Day windows: the day allowance returns only as the oldest spend of the rolling day ages out.
    let dTok = this.day.reduce((n, s) => n + s.tokens, 0) + [...this.leases.values()].reduce((n, s) => n + s.tokens, 0);
    let dReq = this.day.length + this.leases.size;
    const dayAging = [...this.day].sort((a, b) => a.t - b.t);
    let dayAt = now;
    for (const s of dayAging) {
      if (dTok + tokens <= this.limits.tpd && dReq + 1 <= this.limits.rpd) break;
      dTok -= s.tokens; dReq -= 1; dayAt = Math.max(dayAt, s.t + DAY);
    }
    if (dTok + tokens > this.limits.tpd || dReq + 1 > this.limits.rpd) dayAt = Math.max(dayAt, now + 1_000);
    if (dayAt > at) { at = dayAt; kind = "day"; }
    return { at, kind };
  }

  /**
   * Reserves room for a request, waiting (inside `maxWaitMs`) for the minute window. Throws ModelThrottled with the exact
   * resume time when the wait would be longer than allowed (always the case for the daily allowance), and ModelThrottled
   * kind "too_large" when the request can never fit.
   */
  async acquire(tokens: number, maxWaitMs: number): Promise<Lease> {
    for (;;) {
      const now = this.clock.now();
      this.trim(now);
      const slot = this.earliest(tokens, now);
      if (slot === null) throw new ModelThrottled("too_large", 0, now, "This request is larger than the free tier allows in one minute.");
      const wait = slot.at - now;
      if (wait <= 0) {
        const lease = { id: this.nextId++, tokens };
        this.leases.set(lease.id, { t: now, tokens });
        return lease;
      }
      if (slot.kind === "day" || wait > maxWaitMs) throw new ModelThrottled(slot.kind, wait, slot.at, slot.kind === "day" ? "The free daily allowance is used up for now." : "The free per-minute allowance is busy.");
      await this.clock.sleep(Math.min(wait + 100, 15_000));
    }
  }

  /** Replaces the reservation with what Groq reports was used (or the reservation itself if the call never ran: pass 0). */
  settle(lease: Lease, actualTokens: number | null) {
    const held = this.leases.get(lease.id);
    this.leases.delete(lease.id);
    if (!held) return;
    const tokens = actualTokens === null ? held.tokens : actualTokens;
    if (tokens > 0) {
      this.minute.push({ t: held.t, tokens });
      this.day.push({ t: held.t, tokens });
    } else if (actualTokens === 0) {
      // never ran: only the request itself counted at Groq for a rejected call, keep one request in the window
      this.minute.push({ t: held.t, tokens: 0 });
    }
    this.persist();
  }

  /** Learns from Groq's own numbers after any answer, including 429s. */
  observe(headers: { remainingTokens?: number | null; resetTokensMs?: number | null; retryAfterMs?: number | null }) {
    const now = this.clock.now();
    if (typeof headers.remainingTokens === "number" && Number.isFinite(headers.remainingTokens)) { this.remainingTokens = Math.max(0, headers.remainingTokens); this.remainingAt = now; }
    if (typeof headers.retryAfterMs === "number" && headers.retryAfterMs > 0) this.blockedUntil = Math.max(this.blockedUntil, now + headers.retryAfterMs);
    this.persist();
  }

  /** Records that Groq refused with a limit of this kind: nothing is sent before the stated time. */
  blockFor(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + ms);
    this.persist();
  }

  /** What is left today by our own count (never more than Groq allows). Shown in logs and evaluation summaries. */
  usage(): { minuteTokens: number; dayTokens: number; dayRequests: number } {
    this.trim(this.clock.now());
    return { minuteTokens: this.minute.reduce((n, s) => n + s.tokens, 0), dayTokens: this.day.reduce((n, s) => n + s.tokens, 0), dayRequests: this.day.length };
  }
}

/** "1h2m3.5s", "2m", "850ms", "7.5s" → milliseconds (Groq's "try again in …" and reset headers). */
export function parseDuration(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m(?!s))?\s*(?:(\d+(?:\.\d+)?)s)?\s*(?:(\d+(?:\.\d+)?)ms)?\s*$/.exec(text);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined && m[4] === undefined)) return null;
  return Math.ceil(Number(m[1] ?? 0) * 3_600_000 + Number(m[2] ?? 0) * 60_000 + Number(m[3] ?? 0) * 1000 + Number(m[4] ?? 0));
}

export interface LimitHit { kind: "minute" | "day"; unit: "tokens" | "requests"; waitMs: number | null }

/** Reads which limit Groq says was hit and how long to wait. Uses only numbers and unit names, never Groq's wording. */
export function parseLimitHit(body: string, retryAfterHeader: string | null): LimitHit {
  const unit = /\bon (tokens|requests) per (minute|day)\b/i.exec(body);
  const wait = /try again in ((?:\d+(?:\.\d+)?(?:ms|h|m|s)\s*)+)/i.exec(body);
  const header = retryAfterHeader === null || retryAfterHeader.trim() === "" ? NaN : Number(retryAfterHeader);
  const fromHeader = Number.isFinite(header) && header >= 0 ? Math.ceil(header * 1000) : null;
  const fromBody = wait ? parseDuration(wait[1]!.trim()) : null;
  const kind: "minute" | "day" = unit ? (unit[2]!.toLowerCase() as "minute" | "day") : fromBody !== null && fromBody > MINUTE * 2 ? "day" : "minute";
  return { kind, unit: unit ? (unit[1]!.toLowerCase() as "tokens" | "requests") : "tokens", waitMs: fromBody ?? fromHeader };
}

/** Plain sentence for the owner: when the work can continue. */
export function resumeSentence(resumeAt: number, now = Date.now()): string {
  const ms = Math.max(0, resumeAt - now);
  if (ms < 90_000) return "in about a minute";
  if (ms < 3_600_000) return `in about ${Math.ceil(ms / 60_000)} minutes`;
  return `around ${new Date(resumeAt).toISOString().slice(11, 16)} UTC (about ${Math.ceil(ms / 3_600_000)} hours from now)`;
}
