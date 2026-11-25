"use client";

import { useActionState } from "react";

import { editDraft } from "@/app/actions/drafts";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

import type { DraftFieldView } from "./draft";

/** Edit a draft that is waiting for approval. Saving creates a new version; nothing is published. */
export function EditDraftForm({ approvalId, fields }: { approvalId: string; fields: DraftFieldView[] }) {
  const [state, action] = useActionState(editDraft, {} as FormState);
  return (
    <form data-clarity-mask="true" action={action} className="stack">
      <FormMessage state={state} />
      <input type="hidden" name="approval" value={approvalId} />
      {fields.map((f) => (
        <label className="field" key={f.key} htmlFor={`edit-${approvalId}-${f.key}`}>
          <span>{f.label}</span>
          <textarea
            id={`edit-${approvalId}-${f.key}`}
            name={`field:${f.key}`}
            className="input"
            rows={Math.min(8, Math.max(2, Math.ceil(f.text.length / 60)))}
            maxLength={8000}
            defaultValue={f.text}
            required
          />
        </label>
      ))}
      <div>
        <SubmitButton pending="Saving…">Save changes</SubmitButton>
      </div>
    </form>
  );
}
