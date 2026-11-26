import type { CapabilityModule } from "./types";

/**
 * Marketing Execution (§10). Carries out only what the application itself can actually do, and only after the owner
 * authorizes it. Creating a draft, approving a draft, authorizing an action, executing it and verifying it are separate
 * events, enforced in the database (request_execution → authorize_execution (owner only) → execute_authorized, and
 * verification by the next website check). A recommendation is never permission.
 *
 * Supported today (no third-party integration needed):
 *   save_to_workspace  - keeps the exact approved draft version in the workspace record (it can be copied or downloaded)
 *   record_completed   - records that the team did the work themselves; reported, not verified, until a check sees it
 *
 * Not supported (no authorized integration exists): publishing website content, sending email, scheduling social posts,
 * spending on ads. Requests for them are recorded as "unsupported" and never run. The agent never does any of these on its
 * own (§10.2).
 */
export type ExecutionAction = "save_to_workspace" | "record_completed" | "publish_website" | "send_email" | "schedule_social" | "spend_ads";

export interface ExecutionDef {
  action: ExecutionAction;
  label: string;
  supported: boolean;
  /** What the application does when it runs, or why it cannot. */
  does: string;
  /** Needs an approved draft first. */
  needsApprovedDraft: boolean;
}

export const EXECUTIONS: Record<ExecutionAction, ExecutionDef> = {
  save_to_workspace: { action: "save_to_workspace", label: "Save the approved draft", supported: true, needsApprovedDraft: true, does: "Keeps the exact approved version in your workspace record so it can be copied or downloaded." },
  record_completed: { action: "record_completed", label: "Record that it's done", supported: true, needsApprovedDraft: false, does: "Records that your team did this. The next website check confirms it where it can." },
  publish_website: { action: "publish_website", label: "Publish to your website", supported: false, needsApprovedDraft: true, does: "Not available: no website connection exists. Copy the approved draft into your website yourself." },
  send_email: { action: "send_email", label: "Send an email", supported: false, needsApprovedDraft: true, does: "Not available: no email sending connection exists." },
  schedule_social: { action: "schedule_social", label: "Schedule a social post", supported: false, needsApprovedDraft: true, does: "Not available: no social media connection exists." },
  spend_ads: { action: "spend_ads", label: "Run an ad", supported: false, needsApprovedDraft: false, does: "Not available: Something Clicks never spends money for you." },
};
export const isExecutionAction = (v: unknown): v is ExecutionAction => typeof v === "string" && Object.hasOwn(EXECUTIONS, v);

export interface ExecutionTarget {
  /** The card or task is still open (not done, dismissed or completed). */
  open: boolean;
  hasApprovedDraft: boolean;
  /** Actions that already have an open (requested or authorized) record. */
  openActions: ExecutionAction[];
}

export interface ExecutionOption {
  action: ExecutionAction;
  label: string;
  available: boolean;
  reason: string;
}

/** What can be executed for one Action Card or task right now, and why the rest cannot. */
export function executionOptions(t: ExecutionTarget): ExecutionOption[] {
  return (Object.values(EXECUTIONS) as ExecutionDef[]).map((d) => {
    let reason = d.does;
    let available = d.supported;
    if (available && t.openActions.includes(d.action)) { available = false; reason = "Already waiting for authorization or to be carried out."; }
    else if (available && d.needsApprovedDraft && !t.hasApprovedDraft) { available = false; reason = "Approve a draft first."; }
    else if (available && d.action === "record_completed" && !t.open) { available = false; reason = "This is already closed."; }
    return { action: d.action, label: d.label, available, reason };
  });
}

/** The status a customer sees for an execution record, in plain words. */
export function executionStatusLabel(r: { status: string; verification: string | null; integration: string | null }): string {
  if (r.status === "requested") return "Waiting for the owner to authorize";
  if (r.status === "authorized") return "Authorized, not carried out yet";
  if (r.status === "unsupported") return "Not available";
  if (r.status === "cancelled") return "Cancelled";
  if (r.status === "failed") return "Didn't work";
  if (r.verification === "verified") return "Done and confirmed by a website check";
  if (r.verification === "not_verified") return "Done, but the website check still finds the issue";
  return r.integration === "owner_report" ? "Done (reported by your team)" : "Done";
}

export const marketingExecution: CapabilityModule<ExecutionTarget, ExecutionOption[]> = {
  id: "marketing_execution",
  async run(target) {
    const options = executionOptions(target);
    const n = options.filter((o) => o.available).length;
    return { status: "done", output: options, detail: `${n} action${n === 1 ? "" : "s"} can be carried out after the owner authorizes; publishing, sending and ad spend are not available.` };
  },
};
