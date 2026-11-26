/**
 * Promote-a-service campaign (§9) and campaign drafts (§8.4–8.6). Rules only: the playbook is fixed code, and the draft
 * checks are tested on hand-written outputs. Real model output is exercised separately against a running model server.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { planCampaigns, promoteService, type CampaignInput } from "@/lib/campaigns";
import { checkTaskDraft, ContentRejected } from "@/lib/server/agent/modules/content-creation";
import { runCampaignDrafts } from "@/lib/server/agent/orchestrator";

const base: CampaignInput = { businessName: "Sunrise Plumbing", serviceArea: "Plano", primaryGoal: "more_calls", confirmedServices: [], cards: [], own: null, competitors: [] };

afterEach(() => vi.unstubAllEnvs());

describe("promote a service", () => {
  it("is offered only for a service the owner confirmed, and promotes the one asked for", () => {
    expect(promoteService(base)).toBeNull();
    expect(planCampaigns(base).map((c) => c.playbook)).not.toContain("promote_service");
    const c = promoteService({ ...base, confirmedServices: ["drain cleaning", "water heater repair"], focusService: "water heater repair" })!;
    expect(c.title).toBe("Promote water heater repair");
    expect(promoteService({ ...base, confirmedServices: ["drain cleaning"], focusService: "roofing" })!.title).toBe("Promote drain cleaning");
  });

  it("has a brief, channels, a schedule, and nothing points people to the page before it is live", () => {
    const c = promoteService({ ...base, confirmedServices: ["drain cleaning"] })!;
    expect(c.brief).toMatchObject({ objective: "More enquiries for drain cleaning", audience: null, offer: null, core_message: "Sunrise Plumbing offers drain cleaning in Plano.", measurement: ["calls", "form_leads"] });
    const page = c.tasks.findIndex((t) => t.channel === "landing_page") + 1;
    for (const t of c.tasks.filter((x) => x.channel && x.channel !== "landing_page")) expect(t.depends_on).toContain(page);
    for (const [i, t] of c.tasks.entries()) for (const d of t.depends_on ?? []) expect(d).toBeLessThan(i + 1); // only earlier tasks
    expect(c.tasks[0]!.title).toMatch(/numbers for the month before/); // a before figure first
  });

  it("templates use only confirmed facts; unknowns stay [blanks]", () => {
    const c = promoteService({ ...base, serviceArea: "", confirmedServices: ["drain cleaning"] })!;
    const page = c.tasks.find((t) => t.channel === "landing_page")!.deliverable!;
    expect(page).toContain("[the area you serve]");
    expect(page).toContain("[who this is for]");
    expect(page).toContain("[your phone number]");
    expect(page).not.toMatch(/\$\d|\d+ years|guarantee/i);
    const withAudience = promoteService({ ...base, confirmedServices: ["drain cleaning"], confirmedAudience: "homeowners" })!;
    expect(withAudience.brief!.audience).toBe("homeowners");
  });
});

describe("campaign draft checks", () => {
  const source = "Sunrise Plumbing\ndrain cleaning\nPlano";
  it("joins an email into the text the owner edits", () => {
    expect(checkTaskDraft("email", { subject: "Drain cleaning in Plano", body: "Hi [first name], we now offer drain cleaning. [link to the new page]" }, source))
      .toBe("Subject: Drain cleaning in Plano\n\nHi [first name], we now offer drain cleaning. [link to the new page]");
  });

  it("refuses promises, figures not in the source, empty parts and overlong text", () => {
    const bad: [Record<string, string>, RegExp][] = [
      [{ post: "We guarantee same-day service!" }, /promise or claim/],
      [{ post: "Rated 4.9 by 300 customers." }, /number that isn't in your business details/],
      [{ post: "" }, /incomplete/],
      [{ post: "x".repeat(700) }, /too long/],
    ];
    for (const [out, msg] of bad) expect(() => checkTaskDraft("social", out, source)).toThrow(msg);
    expect(() => checkTaskDraft("social", { post: "x" }, source)).not.toThrow();
    expect(() => checkTaskDraft("social", { post: "guaranteed results" }, source)).toThrow(ContentRejected);
  });
});

describe("campaign drafts workflow", () => {
  it("without a model it is recorded as blocked and writes nothing", async () => {
    vi.stubEnv("MARKETING_MODEL_PROVIDER", "");
    const rpc = vi.fn(async (name: string) => ({ data: name === "start_marketing_workflow" ? "wf" : null, error: null }));
    const rows: Record<string, Record<string, unknown>[]> = {
      marketing_campaigns: [{ id: "c1", organization_id: "o1", status: "proposed", brief: { objective: "o", audience: null, offer: null, core_message: "m" }, title: "t" }],
      campaign_tasks: [{ id: "t1", campaign_id: "c1", position: 1, title: "Page", why: "w", channel: "landing_page", deliverable: "x", status: "prepared" }],
    };
    const from = (table: string) => {
      let r = [...(rows[table] ?? [])];
      const q = {
        select: () => q, order: () => q, limit: () => q, in: () => q, not: () => q,
        eq: (k: string, v: unknown) => { r = r.filter((x) => x[k] === v); return q; },
        maybeSingle: async () => ({ data: r[0] ?? null }),
        then: (res: (v: { data: unknown[] }) => unknown) => Promise.resolve({ data: r }).then(res),
      };
      return q;
    };
    const out = await runCampaignDrafts({ rpc, from } as never, { orgId: "o1", campaignId: "c1", profile: { businessName: "S", website: "", serviceArea: null, primaryGoal: null } }, { provider: () => null });
    expect(out).toMatchObject({ status: "blocked", written: 0 });
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("save_task_model_draft");
  });
});
