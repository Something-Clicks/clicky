/**
 * Feature switches for Marketing Agent functionality that is built but not released to customers.
 *
 * Outside Production each switch is OFF unless FEATURE_<NAME>=1 is set on the server. In Production
 * (VERCEL_ENV=production) only the model-free screens listed below RELEASED_IN_PRODUCTION are on; the rest are
 * always off, whatever the variables say. Releasing a feature to customers is an owner decision and a code
 * change here, never just an environment variable.
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

/**
 * Released to customers in Production (owner decision, Nov 28 2026): the screens that need no model. They are ON in Production without any
 * variable; setting FEATURE_<NAME>=0 turns one back off (a kill switch that needs a redeploy, not a code change). Everything else stays
 * off in Production whatever the variables say: `drafts` and `modelFindings` need a model, and no model runs in Production (see provider.ts).
 */
const RELEASED_IN_PRODUCTION: readonly string[] = ["AGENT", "CAMPAIGNS", "BUSINESS_PROFILE", "STRATEGY"];

const on = (name: string) => {
  const v = process.env[`FEATURE_${name}`];
  return releaseAllowed() ? v === "1" : RELEASED_IN_PRODUCTION.includes(name) && v !== "0";
};

/**
 * "Find similar businesses" sends a place name and a short service phrase to OpenStreetMap and DuckDuckGo. The live Privacy Policy does not
 * mention that yet, so in Production it stays off until the owner approves the wording and sets DISCOVERY_IN_PRODUCTION=1.
 */
export const discoveryAvailable = () => releaseAllowed() || process.env.DISCOVERY_IN_PRODUCTION === "1";

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
