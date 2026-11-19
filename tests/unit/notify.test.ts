import { afterEach, describe, expect, it, vi } from "vitest";

import { notify, sendEmail } from "@/lib/server/notify";

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("skips (and says why) when email is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await sendEmail("a@b.c", "s", "t", "/app")).toEqual({ status: "skipped", detail: "Email sending is not configured." });
  });

  it("sends through Resend with escaped HTML and a site link", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Something Clicks <hello@example.com>";
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.example.com/";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    expect((await sendEmail("owner@example.com", "Hi", "Fish & <Chips>", "/app")).status).toBe("sent");
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.html).toContain("Fish &amp; &lt;Chips&gt;");
    expect(body.text).toContain("https://app.example.com/app");
  });

  it("reports provider errors as failed without throwing", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "x@example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422 }));
    expect((await sendEmail("a@b.c", "s", "t", "/")).status).toBe("failed");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect((await sendEmail("a@b.c", "s", "t", "/")).status).toBe("failed");
  });
});

describe("notify", () => {
  it("emails each recipient and logs each attempt", async () => {
    delete process.env.RESEND_API_KEY;
    const rpc = vi.fn(async (name: string) =>
      name === "notification_recipients"
        ? { data: [{ user_id: "u1", email: "a@b.c", full_name: null }, { user_id: "u2", email: "d@e.f", full_name: null }], error: null }
        : { data: null, error: null },
    );
    await notify({ rpc } as never, "org1", "Sunrise", "analysis_complete");
    const logs = rpc.mock.calls.filter(([n]) => n === "log_notification");
    expect(logs).toHaveLength(2);
    expect(logs[0]![1]).toMatchObject({ p_org: "org1", p_user: "u1", p_kind: "analysis_complete", p_status: "skipped" });
  });

  it("never throws, even if the database call fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(notify({ rpc } as never, "org1", "Sunrise", "draft_ready")).resolves.toBeUndefined();
  });
});

describe("weekly worker endpoint", () => {
  it("refuses requests without the right secret", async () => {
    const { GET } = await import("@/app/api/cron/weekly-analysis/route");
    const req = (auth?: string) => ({ headers: new Headers(auth ? { authorization: auth } : {}) }) as never;
    process.env.CRON_SECRET = "a-long-enough-secret-value-123";
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    process.env.CRON_SECRET = "short";
    expect((await GET(req("Bearer short"))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer "))).status).toBe(401);
  });
});
