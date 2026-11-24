/** Plain-language labels for activity_log actions. */
const LABELS: Record<string, string> = {
  "organization.created": "Business account created",
  "organization.renamed": "Business account renamed",
  "business_profile.updated": "Business profile updated",
  "analysis.started": "Website check started",
  "analysis.completed": "Website check finished",
  "analysis.failed": "Website check couldn't finish",
  "action_card.done": "Action marked done",
  "action_card.dismissed": "Action dismissed",
  "action_card.new": "Action reopened",
  "agent_run.started": "Started a draft",
  "agent_run.succeeded": "A draft is ready for your review",
  "agent_run.failed": "A draft couldn't be prepared",
  "approval.approved": "Draft approved",
  "approval.rejected": "Draft rejected",
  "approval.changes_requested": "Changes requested on a draft",
  "outcome.fixed": "A completed action was verified fixed",
  "outcome.still_found": "A completed action's issue was found again",
  "preview.claimed": "Saved your first result",
  "billing.purchase_confirmed": "Payment received",
  "billing.subscription_active": "Plan started",
  "billing.subscription_trialing": "Plan trial started",
  "billing.subscription_past_due": "Plan payment failed",
  "billing.subscription_unpaid": "Plan payment failed",
  "billing.subscription_canceled": "Plan canceled",
  "billing.subscription_paused": "Plan paused",
  "billing.subscription_incomplete": "Waiting for plan payment",
  "billing.subscription_incomplete_expired": "Plan payment expired",
};

const FIELD_LABELS: Record<string, string> = {
  business_name: "business name",
  website: "website",
  service_area: "service area",
  primary_goal: "main goal",
};

export function activityLabel(action: string): string {
  return LABELS[action] ?? action.replace(/[._]/g, " ");
}

export function activityDetail(metadata: unknown): string | null {
  const m = metadata as { fields?: unknown; cards?: number; evidence?: number; from_preview?: boolean; plan?: string } | null;
  if (typeof m?.cards === "number") {
    const things = `${m.cards} thing${m.cards === 1 ? "" : "s"} to fix`;
    return m.from_preview || typeof m.evidence !== "number" ? things : `${things}, from ${m.evidence} pieces of evidence`;
  }
  const fields = m?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const names = fields.map((f) => FIELD_LABELS[String(f)] ?? String(f));
  return `Changed: ${names.join(", ")}`;
}

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
    new Date(iso),
  ) + " UTC";
}
