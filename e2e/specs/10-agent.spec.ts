/**
 * The Marketing Agent loop in the browser: Ask (the orchestrator understands the request and runs the right workflow),
 * Research (owner-supplied keyword export, labelled), Execute (owner-authorized, recorded, never publishing) and Measure
 * (supplied figures compared fairly). Runs against the LOCAL stack only, with FEATURE_AGENT=1 and FEATURE_STRATEGY=1.
 * No model is configured, so every "written" output here is fixed rules or fixed checks, and the screens say so.
 */
import { expect, test } from "../fixtures";
import { noSideScroll } from "../fixtures/auth";
import { INTERNALS, sql } from "../fixtures/env";

test.describe.configure({ mode: "serial" });

const PROD = process.env.E2E_PROD_BASE;

test.describe("Ask, research, execute and measure", () => {
  test("an unclear request gets a choice, never a guess", async ({ page }) => {
    await page.goto("/app/ask");
    await expect(page.getByRole("heading", { name: "Ask" })).toBeVisible();
    await page.getByLabel("What would you like help with?").fill("hello there");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText("Which of these do you mean?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Review my results" })).toBeVisible();
    await noSideScroll(page);
  });

  test("“What should I work on first?” runs the plan workflow and shows a plan built from the website check", async ({ page, owner }) => {
    await page.goto("/app/ask");
    await page.getByLabel("What would you like help with?").fill("What should I work on first?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page).toHaveURL(/\/app\/plan/, { timeout: 60_000 });
    await expect(page.getByText("Waiting for your review")).toBeVisible();
    await expect(page.getByText(/Put together with fixed rules/)).toBeVisible();
    // The request was recorded as a workflow with every capability it used.
    const row = sql(`select status || '|' || array_to_string(capabilities, ',') from public.marketing_workflows where organization_id = '${owner.orgId}' and kind = 'marketing_plan' and request = 'What should I work on first?' order by started_at desc limit 1`);
    expect(row).toBe("prepared|business_intelligence,market_research,website_intelligence,marketing_analysis,marketing_strategy");
    await page.goto("/app/ask");
    await page.getByText("“What should I work on first?”").first().click();
    await expect(page.getByText(/with fixed rules \(impact, evidence, effort, order, goal, earlier decisions\)/)).toBeVisible();
  });

  test("a headline request finds the evidence but writes nothing without a model, and says so", async ({ page }) => {
    await page.goto("/app/ask");
    await page.getByLabel("What would you like help with?").fill("Can you improve my homepage headline?");
    await page.getByRole("button", { name: "Ask" }).click();
    // Either the check found a headline problem (we land on it, and no draft is written) or it found none. The notice is shown for an
    // instant before the app navigates to the action, so landing on the action counts as seeing the outcome (this was a timing race).
    const notice = page.getByText(/We can't write new headlines yet, so nothing was written|didn't find a problem with your homepage headline/);
    await Promise.race([notice.waitFor({ state: "visible", timeout: 30_000 }), page.waitForURL(/\/app\/actions\/[0-9a-f-]{36}/, { timeout: 30_000 })]);
    // Nothing was written: no draft is waiting for approval on the page we ended up on.
    await expect(page.getByText(/Draft (is )?ready|Approve this draft/i)).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    await expect(page.locator("main")).not.toContainText(/\bAI\b|language model|\bagents?\b/i);
  });

  test("keyword research from a Semrush export is kept with its source and date, labelled as estimates", async ({ page }) => {
    await page.goto("/app/library");
    await page.getByLabel("Where the keywords come from").selectOption("semrush_export");
    await page.getByLabel("Date of the export").fill("2026-11-01");
    await page.getByLabel("Or paste it here").fill('Keyword,Position,Search Volume,Keyword Difficulty\n"node js download",3,"12,100",61\nnode lts,8,2400,40\n');
    await page.getByRole("button", { name: "Import" }).click();
    await expect(page.getByText("Imported 2 keywords.")).toBeVisible();
    const row = page.getByRole("row", { name: /node js download/ });
    await expect(row).toContainText("12,100");
    await expect(row).toContainText(/Estimate · 2026-11-01/);
    await noSideScroll(page);
  });

  test("execution: a request waits for the owner, then is carried out and recorded; publishing is never offered", async ({ page, owner }) => {
    const cardId = sql(`select id from public.action_cards where organization_id = '${owner.orgId}' and status = 'new' and stage = 'prepared' order by created_at limit 1`);
    await page.goto(`/app/actions/${cardId}`);
    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Getting it done" }) });
    await expect(panel).toContainText("We never publish to your website, send emails or spend money for you.");
    await expect(panel.getByText("Publish to your website.", { exact: true })).toHaveCount(0);
    await expect(panel).toContainText(/Save the approved draft\. Approve a draft first\./);
    await panel.locator("li", { hasText: "Record that it's done" }).getByRole("button", { name: "Ask for this" }).click();
    await expect(panel).toContainText("Waiting for the owner to authorize");
    expect(sql(`select status from public.action_cards where id = '${cardId}'`)).toBe("new"); // a request alone changes nothing
    await panel.getByRole("button", { name: "Yes, do it" }).click();
    await expect(panel).toContainText("Done (reported by your team)");
    expect(sql(`select status || '|' || (authorized_at is not null) || '|' || (executed_at is not null) || '|' || coalesce(integration, '') from public.execution_records where card_id = '${cardId}'`)).toBe("succeeded|true|true|owner_report");
    expect(sql(`select status || '|' || completion_basis from public.action_cards where id = '${cardId}'`)).toBe("done|reported");
  });

  test("results compare only the figures supplied, for equal periods, and say what they can't show", async ({ page }) => {
    await page.goto("/app/results");
    const add = async (from: string, to: string, value: string) => {
      await page.locator("select[name=metric]").selectOption("calls");
      await page.locator("input[name=period_start]").fill(from);
      await page.locator("input[name=period_end]").fill(to);
      await page.locator("input[name=value]").fill(value);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Saved.")).toBeVisible();
    };
    await add("2026-09-01", "2026-09-30", "40");
    await add("2026-10-01", "2026-10-30", "52");
    await page.getByRole("button", { name: /Review (my results|again)/ }).click();
    const table = page.getByRole("table");
    await expect(table.getByRole("row", { name: /Phone calls/ })).toContainText("+12 (+30%)");
    await expect(page.getByText(/do not show that any one piece of work caused a change/)).toBeVisible();
    await expect(page.getByText(/1 fix|Carried out after your OK/).first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(INTERNALS);
    await noSideScroll(page);
  });

  test("in Production Ask, Results and Research exist, and nothing says a model is writing", async ({ page }) => {
    test.skip(!PROD, "needs the production-mode server (E2E_PROD_BASE, no FEATURE_* variables)");
    for (const [path, heading] of [["/app/ask", "Ask"], ["/app/results", "Results"], ["/app/library", "Research"]] as const) {
      await page.goto(`${PROD}${path}`);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(page.locator("main")).not.toContainText(INTERNALS);
      await expect(page.locator("main")).not.toContainText(/\bAI\b|language model|\bagents?\b/i);
    }
  });
});
