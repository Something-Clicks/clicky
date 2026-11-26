import { checkSite } from "../sitecheck/run";
import type { EvalCase } from "./dataset/types";
import type { FetchedPage } from "@/lib/server/safe-fetch";

/** The three cases chosen for independent human review: the ones with the most judgment in them. */
export const REVIEW_CASES = ["T1", "T3", "T7"] as const;

/** The open actions the fixed checks produce for a case, in plain words (what the plan is built from). */
export async function openActionsFor(c: EvalCase): Promise<string[]> {
  const r = await checkSite(`https://${c.id.toLowerCase()}.example/`, { businessName: c.business.name, serviceArea: c.business.serviceArea, primaryGoal: c.business.primaryGoal }, {
    fetchPage: async (url: string): Promise<FetchedPage> => { const b = c.pages[new URL(url).pathname || "/"]; return { url, status: b ? 200 : 404, contentType: "text/html", body: b ?? "", truncated: false, redirects: [] }; },
    pageSpeed: async () => ({ ok: false as const, reason: "n/a" }),
  });
  return r.findings.map((f) => `${f.title} (${f.impact} impact; ${f.recommended_action})`);
}
