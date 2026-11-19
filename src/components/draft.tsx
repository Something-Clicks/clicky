import { CopyButton } from "@/app/app/actions/[id]/copy-button";

export interface DraftFieldView {
  key: string;
  label: string;
  text: string;
}

export const DRAFT_LABEL: Record<string, string> = {
  meta: "Page title and description",
  page_copy: "Homepage copy",
  gbp_post: "Google Business Profile post",
  review_reply: "Review reply",
  blog_draft: "Blog post draft",
};

export function draftFields(output: unknown): DraftFieldView[] {
  const fields = (output as { fields?: DraftFieldView[] } | null)?.fields;
  return Array.isArray(fields) ? fields : [];
}

export const draftAsText = (fields: DraftFieldView[]) => fields.map((f) => `${f.label}\n${f.text}`).join("\n\n");

/** The reference's .mock preview box. Text is rendered as text, never as HTML. */
export function DraftPreview({ fields }: { fields: DraftFieldView[] }) {
  return (
    <div className="mock">
      {fields.map((f) => (
        <div key={f.key} style={{ marginBottom: 10 }}>
          <b>{f.label}</b>
          <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{f.text}</p>
        </div>
      ))}
    </div>
  );
}

export function DraftUseButtons({ approvalId, fields }: { approvalId: string; fields: DraftFieldView[] }) {
  return (
    <>
      <CopyButton text={draftAsText(fields)} label="Copy text" />
      <a className="btn outline" href={`/app/approvals/${approvalId}/download`} download>
        Download
      </a>
    </>
  );
}
