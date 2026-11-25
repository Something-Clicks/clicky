import type { CapabilityModule } from "./types";

/**
 * Performance Intelligence (§11), today: what happened to completed and approved work. The
 * verification itself runs in the database when an analysis is saved (verify_outcomes: "fixed"
 * only when the same check no longer fires and its source was actually checked). Traffic, search
 * and conversion data need authorized integrations and are not connected.
 */
export interface OutcomeCard {
  status: string;
  verification: string | null;
}

export interface PerformanceSummary {
  completed_or_approved: number;
  verified_fixed: number;
  still_found: number;
  awaiting_check: number;
  traffic_data: "not_connected";
}

export const performanceIntelligence: CapabilityModule<{ cards: OutcomeCard[] }, PerformanceSummary> = {
  id: "performance_intelligence",
  async run({ cards }) {
    const tracked = cards.filter((c) => c.status === "done" || c.status === "approved");
    const out: PerformanceSummary = {
      completed_or_approved: tracked.length,
      verified_fixed: tracked.filter((c) => c.verification === "fixed").length,
      still_found: tracked.filter((c) => c.verification === "still_found").length,
      awaiting_check: tracked.filter((c) => !c.verification).length,
      traffic_data: "not_connected",
    };
    return {
      status: "done",
      output: out,
      detail: `${out.verified_fixed} verified fixed, ${out.still_found} still found, ${out.awaiting_check} waiting for the next check.`,
    };
  },
};
