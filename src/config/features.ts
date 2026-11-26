/**
 * Feature switches for Marketing Agent functionality that is built but not released to customers.
 *
 * Each switch is OFF unless FEATURE_<NAME>=1 is set on the server, and it is ALWAYS off in Production
 * (VERCEL_ENV=production), whatever the variables say. Releasing a feature to customers is an owner
 * decision and a code change here, never just an environment variable.
 *
 *   drafts          - Content Creation: prepare a draft, edit it (each edit is a version), the owner
 *                     approves a version.
 *   businessProfile - the owner's "Business details" screen: review what the Marketing Agent learned.
 *   modelFindings   - model-assisted Marketing Analysis findings shown as Action Cards.
 *   strategy        - Marketing Strategy: a proposed plan (objectives, ordered priorities, next steps) the
 *                     owner reviews, revises, approves or rejects.
 *   campaigns       - Research (compare with websites the owner names) and Campaigns (fixed playbooks, guided tasks the
 *                     owner approves, edits and marks done). Needs no model.
 *   agent           - Ask (one request box; the orchestrator understands it and runs the right workflow), Results
 *                     (supplied figures, outcomes, follow-ups), the Research Library keyword import, and execution
 *                     records on each action (owner-authorized saving and recording; no publishing). Needs no model.
 *
 * Server-only: read these in server components and server actions, and pass plain booleans to client
 * components (client bundles never see these variables, so they would always read false).
 */
export const releaseAllowed = () => process.env.VERCEL_ENV !== "production";

const on = (name: string) => releaseAllowed() && process.env[`FEATURE_${name}`] === "1";

export const FEATURES = {
  get drafts() {
    return on("DRAFTS");
  },
  get businessProfile() {
    return on("BUSINESS_PROFILE");
  },
  get modelFindings() {
    return on("MODEL_FINDINGS");
  },
  get strategy() {
    return on("STRATEGY");
  },
  get campaigns() {
    return on("CAMPAIGNS");
  },
  get agent() {
    return on("AGENT");
  },
};
