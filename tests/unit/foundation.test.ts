import { describe, expect, it } from "vitest";

import { formatPrice, PLANS } from "@/config/pricing";
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
  it("holds the approved working prices", () => {
    expect(formatPrice(PLANS.diagnostic_audit)).toBe("$39");
    expect(formatPrice(PLANS.starter_ai)).toBe("$49");
    expect(formatPrice(PLANS.growth_ai)).toBe("$149");
    expect(formatPrice(PLANS.scale_automation)).toBe("$399");
    expect(PLANS.diagnostic_audit.interval).toBe("one_time");
    expect(Object.values(PLANS).filter((p) => p.interval === "month")).toHaveLength(3);
  });
});

describe("activity labels", () => {
  it("explains events in plain language", () => {
    expect(activityLabel("organization.created")).toBe("Business account created");
    expect(activityDetail({ fields: ["website", "primary_goal"] })).toBe("Changed: website, main goal");
    expect(activityDetail({})).toBeNull();
  });
});
