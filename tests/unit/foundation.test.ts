import { describe, expect, it } from "vitest";

import { PLANS, planForPrice, priceLabel, resolvePrice } from "@/config/pricing";
import { activityDetail, activityLabel } from "@/lib/activity";
import { formatLine, redact } from "@/lib/log";
import { isProtectedPath, safeNextPath } from "@/lib/redirect";
import { businessSchema, normalizeWebsite, signUpSchema } from "@/lib/validation";

describe("safeNextPath: no open redirects", () => {
  it.each(["/app", "/app/settings?tab=1", "/admin"])("keeps same-site path %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "app",
    "",
    "/app\nSet-Cookie: x",
    undefined,
    ["/app"],
  ])("rejects %j", (p) => {
    expect(safeNextPath(p)).toBe("/app");
  });
});

describe("isProtectedPath", () => {
  it("protects /app and /admin trees only", () => {
    expect(isProtectedPath("/app")).toBe(true);
    expect(isProtectedPath("/app/settings")).toBe(true);
    expect(isProtectedPath("/admin")).toBe(true);
    expect(isProtectedPath("/application")).toBe(false);
    expect(isProtectedPath("/administrator")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/pricing")).toBe(false);
  });
});

describe("website validation", () => {
  it("adds https:// when missing", () => {
    expect(normalizeWebsite("example.com")).toBe("https://example.com/");
  });
  it("accepts http and https", () => {
    expect(normalizeWebsite("http://shop.example.com/path")).toBe("http://shop.example.com/path");
  });
  it("treats empty as no website", () => {
    expect(normalizeWebsite("  ")).toBeNull();
  });
  it.each(["javascript:alert(1)", "ftp://example.com", "https://user:pw@example.com", "https://localhost", "not a url"])(
    "rejects %s",
    (v) => {
      expect(() => normalizeWebsite(v)).toThrow();
    },
  );
  it("produces a value the database constraint accepts", () => {
    const parsed = businessSchema.parse({
      businessName: " Alpha ",
      website: "alpha.example",
      serviceArea: "",
      primaryGoal: null,
    });
    expect(parsed).toEqual({ businessName: "Alpha", website: "https://alpha.example/", serviceArea: null, primaryGoal: null });
    expect(/^https?:\/\/[^\s/@]+\.[^\s/@]+(\/\S*)?$/i.test(parsed.website!)).toBe(true);
  });
  it("rejects an unknown goal", () => {
    expect(
      businessSchema.safeParse({ businessName: "A", website: "", serviceArea: "", primaryGoal: "hack" }).success,
    ).toBe(false);
  });
});

describe("sign-up validation", () => {
  it("requires a name, valid email and 8+ character password", () => {
    expect(signUpSchema.safeParse({ fullName: "", email: "x", password: "short" }).error?.issues).toHaveLength(3);
    expect(signUpSchema.parse({ fullName: "Ana", email: " Ana@Example.COM ", password: "longenough" }).email).toBe(
      "ana@example.com",
    );
  });
});

describe("structured logging", () => {
  it("redacts secrets and personal data, including nested keys", () => {
    expect(
      redact({ userId: "u1", email: "a@b.c", nested: { access_token: "t", password: "p", ok: 1 }, apiKey: "k" }),
    ).toEqual({ userId: "u1", email: "[redacted]", nested: { access_token: "[redacted]", password: "[redacted]", ok: 1 }, apiKey: "[redacted]" });
  });
  it("writes one JSON line with level and event", () => {
    const line = JSON.parse(formatLine("info", "auth.signed_up", { userId: "u1" }));
    expect(line).toMatchObject({ level: "info", event: "auth.signed_up", userId: "u1" });
    expect(typeof line.ts).toBe("string");
  });
  it("summarizes errors without throwing", () => {
    expect(redact(new Error("boom"))).toMatchObject({ name: "Error", message: "boom" });
  });
});

describe("price catalog", () => {
  it("holds the approved customer-facing names, the unchanged Stripe names, and the prices", () => {
    expect(Object.values(PLANS).map((p) => p.name)).toEqual(["Marketing Report", "Marketing Assistant", "Marketing Studio", "Marketing Suite"]);
    // Stripe was not changed: its products keep their names.
    expect(Object.values(PLANS).map((p) => p.stripeName)).toEqual(["Marketing Plan", "Single Site", "Business Plus", "Multi-Site"]);
    expect(Object.values(PLANS).map((p) => p.tier)).toEqual(["current", "current", "planned", "planned"]);
    expect(priceLabel("marketing_plan", "one_time")).toBe("$49 one-time");
    expect(priceLabel("single_site", "month")).toBe("$79/month");
    expect(priceLabel("single_site", "year")).toBe("$756 billed yearly");
    expect(priceLabel("business_plus", "month")).toBe("$179/month");
    expect(priceLabel("business_plus", "year")).toBe("$1,716 billed yearly");
    expect(priceLabel("multi_site", "month")).toBe("$399/month");
    expect(priceLabel("multi_site", "year")).toBe("$3,828 billed yearly");
    expect(priceLabel("marketing_plan", "year")).toBe("");
  });

  it("maps the exact LIVE ids", () => {
    const live = (plan: Parameters<typeof resolvePrice>[0], i: Parameters<typeof resolvePrice>[1]) => resolvePrice(plan, i, "live");
    expect(live("marketing_plan", "one_time")).toEqual({ ok: true, priceId: "price_1Uen3OFnFMCbDhHEw36S1zXr", productId: "prod_Vg9MOCNzSD7QlV", amount: 4900 });
    expect(live("single_site", "month")).toMatchObject({ priceId: "price_1Uen6xFnFMCbDhHEm8XTUgNR", productId: "prod_Vg9PQyz53iF3nS", amount: 7900 });
    expect(live("single_site", "year")).toMatchObject({ priceId: "price_1Uen6xFnFMCbDhHEVERLfWyA", amount: 75600 });
    expect(live("business_plus", "month")).toMatchObject({ priceId: "price_1Uen7RFnFMCbDhHEjuPCIKjK", productId: "prod_Vg9QSKyOjmg9oL", amount: 17900 });
    expect(live("business_plus", "year")).toMatchObject({ priceId: "price_1Uen7uFnFMCbDhHE7l1ZLhw7", amount: 171600 });
    expect(live("multi_site", "month")).toMatchObject({ priceId: "price_1Uen8GFnFMCbDhHE4Bx85tPA", productId: "prod_Vg9Rsw79aaZCgs", amount: 39900 });
    expect(live("multi_site", "year")).toMatchObject({ priceId: "price_1Uen8ZFnFMCbDhHEYeMMWK7K", amount: 382800 });
    expect(planForPrice("price_1Uen7uFnFMCbDhHE7l1ZLhw7", "live")).toEqual({ plan: "business_plus", interval: "year" });
  });

  it("never borrows ids from the other mode", () => {
    // A live id is unknown in test mode, and a test id is unknown in live mode.
    expect(planForPrice("price_1Uen6xFnFMCbDhHEm8XTUgNR", "test")).toBeNull();
    expect(planForPrice("price_1Uf9AQFnFMCbDhHEdFmjNCCM", "live")).toBeNull();
    const live = resolvePrice("single_site", "month", "live");
    const test = resolvePrice("single_site", "month", "test");
    expect(live.ok && test.ok && live.priceId !== test.priceId && live.productId !== test.productId).toBe(true);
    expect(resolvePrice("marketing_plan", "month", "live")).toEqual({ ok: false, missing: "marketing_plan has no month price" });
  });

  it("has a TEST id for every live price, with the same plan and interval", () => {
    for (const plan of Object.keys(PLANS) as (keyof typeof PLANS)[]) {
      for (const interval of Object.keys(PLANS[plan].amounts) as ("one_time" | "month" | "year")[]) {
        const l = resolvePrice(plan, interval, "live");
        const t = resolvePrice(plan, interval, "test");
        expect(l.ok && t.ok, `${plan} ${interval}`).toBe(true);
        if (l.ok && t.ok) {
          expect(t.amount).toBe(l.amount);
          expect(planForPrice(t.priceId, "test")).toEqual({ plan, interval });
          expect(planForPrice(l.priceId, "live")).toEqual({ plan, interval });
        }
      }
    }
  });

  it("reports which id is missing when a mode has none", () => {
    expect(resolvePrice("single_site", "week" as never, "test")).toEqual({ ok: false, missing: "single_site has no week price" });
  });

  it("offers only plans whose promises the app keeps", () => {
    expect(PLANS.marketing_plan.available).toBe(true);
    expect(PLANS.single_site.available).toBe(true);
    // Marketing Studio and Marketing Suite are planned future tiers: never sold.
    expect(PLANS.business_plus.available).toBe(false);
    expect(PLANS.multi_site.available).toBe(false);
    for (const p of Object.values(PLANS)) expect(p.available).toBe(p.tier === "current");
  });
});

describe("activity labels", () => {
  it("explains events in plain language", () => {
    expect(activityLabel("organization.created")).toBe("Business account created");
    expect(activityDetail({ fields: ["website", "primary_goal"] })).toBe("Changed: website, main goal");
    expect(activityDetail({})).toBeNull();
    expect(activityDetail({ cards: 7, evidence: 12 })).toBe("7 things to fix, from 12 pieces of evidence");
    expect(activityDetail({ cards: 1, from_preview: true })).toBe("1 thing to fix");
    expect(activityLabel("preview.claimed")).toBe("Saved your first result");
    expect(activityLabel("billing.subscription_active")).toBe("Plan started");
    // No label that a customer sees may use the banned words.
    for (const a of ["agent_run.started", "agent_run.succeeded", "agent_run.failed", "analysis.started"]) {
      expect(activityLabel(a)).not.toMatch(/\b(AI|agents?|prompts?|campaigns?)\b/);
    }
  });
});
