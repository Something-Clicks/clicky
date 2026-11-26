/**
 * How long the model steps of one piece of work may take, counted from its start.
 *
 * On Vercel a request is killed at its page limit (120 s for checks and plans, 300 s for campaign drafts), so those paths keep
 * fixed deadlines inside the limit and ignore any override. Durable background jobs (Trigger.dev, `maxDuration` 600 s) are not
 * bound by a request, so they get a long deadline: that is what makes slower models (for example CPU-only inference while
 * evaluating, or a larger model on modest hardware) usable. Outside Vercel (local development, a self-run server) the
 * AGENT_DEADLINE_MS variable (30,000 to 600,000) sets it, so the same code can be exercised with a slow model.
 * A deadline only limits waiting: spend is still bounded by the per-business caps in metering.ts.
 */
export const REQUEST_DEADLINE_MS = 105_000;
export const CAMPAIGN_DEADLINE_MS = 280_000;
/** Inside the 600 s task limit, leaving room to save results and close records. */
export const BACKGROUND_DEADLINE_MS = 540_000;

export function deadlineMs(fallback: number, env: Record<string, string | undefined> = process.env): number {
  if (env.VERCEL) return fallback;
  const n = Number(env.AGENT_DEADLINE_MS);
  return Number.isFinite(n) && n >= 30_000 && n <= 600_000 ? Math.round(n) : fallback;
}
