import { planCampaigns, type Campaign, type CampaignInput } from "@/lib/campaigns";

import type { CapabilityModule } from "./types";

/**
 * Campaign Planning (§9) from fixed playbooks: deterministic, no model. Offers only the playbooks that something
 * observed calls for and returns them as proposals; the owner approves a campaign, does the work, and records it.
 * Returns "blocked" with the reason when nothing observed calls for a campaign (never filler).
 */
export const campaignPlanning: CapabilityModule<CampaignInput, Campaign[]> = {
  id: "campaign_planning",
  async run(input) {
    const campaigns = planCampaigns(input);
    if (!campaigns.length) return { status: "blocked", reason: "Nothing we've found calls for a campaign yet. Check your website, or compare it with a site you admire." };
    const tasks = campaigns.reduce((n, c) => n + c.tasks.length, 0);
    return { status: "done", output: campaigns, detail: `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} proposed with ${tasks} task${tasks === 1 ? "" : "s"}, from fixed playbooks.` };
  },
};
