/** Plain-language labels for activity_log actions. */
const LABELS: Record<string, string> = {
  "organization.created": "Business account created",
  "organization.renamed": "Business account renamed",
  "business_profile.updated": "Business profile updated",
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
  const fields = (metadata as { fields?: unknown } | null)?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;
  const names = fields.map((f) => FIELD_LABELS[String(f)] ?? String(f));
  return `Changed: ${names.join(", ")}`;
}

export function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
    new Date(iso),
  ) + " UTC";
}
