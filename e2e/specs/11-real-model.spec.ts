/**
 * Real-model walk-through: the whole loop on a REAL website with REAL inference (a self-hosted model server, or Groq's free tier with
 * MARKETING_MODEL_PROVIDER=groq and E2E_EXPECT_MODEL=<the model id>), through the app. Run only with E2E_MODEL=1 against a server started with
 * the provider's variables and the FEATURE_* switches
 * (see docs/agents/END_TO_END_RUN.md). The first website check ran in e2e/setup against E2E_SITE.
 *
 * It asserts the rules (nothing unsupported is kept, nothing is sent or published, every step is recorded) and PRINTS what the
 * model actually wrote. It does not assert that the model's work is good: quality is judged by people against the frozen
 * standard (docs/agents/MODEL_EVALUATION_PLAN.md), never by this test.
 */
import { expect, test } from "../fixtures";
import { COMPARE_SITES, sql } from "../fixtures/env";

test.skip(process.env.E2E_MODEL !== "1", "needs a model server (E2E_MODEL=1)");
test.describe.configure({ mode: "serial" });
test.setTimeout(1_500_000);

const SERVICE = process.env.E2E_SERVICE ?? "marketing recommendations";

test.describe("real website, real model", () => {
  test("the owner confirms what the business does (a detail taken from the site's own text)", async ({ page, owner }) => {
    await page.goto("/app/business");
    await page.locator("select[name=field]").selectOption("business.service");
    await page.locator("input[name=value]").fill(SERVICE);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(SERVICE).first()).toBeVisible();
    expect(sql(`select source || '|' || evidence_class || '|' || status from public.business_facts where organization_id = '${owner.orgId}' and field = 'service' and value = '${SERVICE}'`)).toMatch(/^owner\|verified\|confirmed$/);
  });

  test("“Promote …” builds a campaign from the confirmed service", async ({ page, owner }) => {
    await page.goto("/app/ask");
    await page.getByLabel("What would you like help with?").fill(`Prepare a promotional campaign for our ${SERVICE}`);
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page).toHaveURL(/\/app\/campaigns/, { timeout: 60_000 });
    const id = sql(`select id from public.marketing_campaigns where organization_id = '${owner.orgId}' and playbook = 'promote_service' and status = 'proposed' order by created_at desc limit 1`);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await page.goto(`/app/campaigns/${id}`);
    await expect(page.getByRole("heading", { name: "The plan" })).toBeVisible();
    await expect(page.getByText(`Promote ${SERVICE}`).first()).toBeVisible();
    await expect(page.getByText(/Do first:/).first()).toBeVisible(); // email and posts wait for the page
    await page.getByRole("button", { name: "Approve this campaign" }).click();
    await expect(page.getByRole("heading", { name: "How it's going" })).toBeVisible();
    // The task that waits for the page cannot be ticked yet.
    await expect(page.getByRole("button", { name: "I did this" })).toHaveCount(2); // numbers-before and the page
  });

  test("the model writes the campaign drafts; each one is checked, stored beside the template, and nothing is sent", async ({ page, owner }) => {
    const id = sql(`select id from public.marketing_campaigns where organization_id = '${owner.orgId}' and playbook = 'promote_service' and status = 'approved' order by created_at desc limit 1`);
    await page.goto(`/app/campaigns/${id}`);
    await page.getByRole("button", { name: /Write the drafts for me|Write them again/ }).click();
    await expect(page.getByText(/Wrote \d+ drafts?|didn't pass|We can't write|didn't finish|No draft passed/).first()).toBeVisible({ timeout: 1_400_000 });
    const rows = sql(`select position || '|' || channel || '|' || (deliverable_model is not null) from public.campaign_tasks where campaign_id = '${id}' and channel is not null order by position`);
    const written = sql(`select count(*) from public.campaign_tasks where campaign_id = '${id}' and deliverable_model is not null`);
    const out = sql(`select coalesce(string_agg('--- ' || title || E'\\n' || deliverable_model, E'\\n\\n' order by position), '(no draft passed the checks)') from public.campaign_tasks where campaign_id = '${id}' and deliverable_model is not null`);
    console.log(`DRAFT ROWS\n${rows}\nWRITTEN: ${written}\n${out}`);
    const wf = sql(`select status || '|' || coalesce(provider, '') || '|' || coalesce(model, '') || '|' || coalesce(usage::text, '') from public.marketing_workflows where organization_id = '${owner.orgId}' and request = 'Write the campaign drafts' order by started_at desc limit 1`);
    console.log(`WORKFLOW: ${wf}`);
    // Whatever the model did, the rules hold: the template is untouched, the model is named, nothing was executed.
    expect(sql(`select count(*) from public.campaign_tasks where campaign_id = '${id}' and deliverable_model is not null and deliverable is null`)).toBe("0");
    expect(sql(`select count(*) from public.execution_records where organization_id = '${owner.orgId}' and status in ('succeeded')`)).toBe(sql(`select count(*) from public.execution_records where organization_id = '${owner.orgId}' and action = 'record_completed' and status = 'succeeded'`));
    if (Number(written) > 0) expect(sql(`select count(*) from public.campaign_tasks where campaign_id = '${id}' and deliverable_model is not null and deliverable_model_by ->> 'model' <> '${process.env.E2E_EXPECT_MODEL ?? "qwen2.5-1.5b-instruct-q4_k_m"}'`)).toBe("0");
    const spend = sql(`select count(*) || ' calls, ' || coalesce(sum(input_tokens),0) || ' in, ' || coalesce(sum(output_tokens),0) || ' out' from public.model_usage where organization_id = '${owner.orgId}'`);
    console.log(`USAGE RECORDED: ${spend}`);
  });

  test("comparing real sites adds a written summary in which every point cites a source that was actually read", async ({ page, owner }) => {
    await page.goto("/app/research");
    await page.getByLabel(/Websites to compare/).fill(COMPARE_SITES.join("\n"));
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByText(/Compared \d+ websites?\./)).toBeVisible({ timeout: 600_000 });
    const raw = sql(`select coalesce(result -> 'summary' -> 'points', '[]'::jsonb)::text || '|' || coalesce((select string_agg(host, ',') from public.competitor_scans where organization_id = '${owner.orgId}' and status = 'done'), '') from public.marketing_workflows where organization_id = '${owner.orgId}' and kind = 'competitor_research' order by started_at desc limit 1`);
    const [pointsJson, hosts] = [raw.slice(0, raw.lastIndexOf("|")), raw.slice(raw.lastIndexOf("|") + 1)];
    const points = JSON.parse(pointsJson) as { statement: string; kind: string; sources: string[]; evidence_class: string }[];
    const known = new Set(["own", ...hosts.split(",").filter(Boolean)]);
    console.log(`RESEARCH SUMMARY (${points.length} points)\n${points.map((p) => `- [${p.kind}] ${p.statement} (sources: ${p.sources.join(", ")})`).join("\n")}`);
    // Whatever the model wrote: nothing survives without a real source, and it is never presented as measured.
    for (const p of points) { expect(p.sources.length).toBeGreaterThan(0); for (const src of p.sources) expect(known.has(src)).toBe(true); expect(p.evidence_class).toBe("inferred"); }
    await page.reload();
    if (points.length) {
      await expect(page.getByText(/our reading, not a measurement/).first()).toBeVisible();
      // The statement of what was NOT researched is fixed text, always shown with the summary.
      await expect(page.getByText(/We did not look up traffic, rankings, ad spend or customer reviews/)).toBeVisible();
    }
  });
});
