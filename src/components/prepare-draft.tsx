"use client";

import { useActionState } from "react";

import { prepareDraft } from "@/app/actions/drafts";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function PrepareDraftForm({ cardId, label, defaultNotes = "" }: { cardId: string; label: string; defaultNotes?: string }) {
  const [state, action] = useActionState(prepareDraft, {} as FormState);
  return (
    <form data-clarity-mask="true" action={action}>
      <FormMessage state={state} />
      {state.ok ? null : (
        <>
          <label className="field" htmlFor={`notes-${cardId}`}>
            <span>Anything we should know? (optional)</span>
            <textarea
              id={`notes-${cardId}`}
              name="instructions"
              className="input"
              rows={3}
              maxLength={1000}
              defaultValue={defaultNotes}
              placeholder="For example: mention emergency service, keep it friendly"
            />
          </label>
          <input type="hidden" name="id" value={cardId} />
          <SubmitButton pending="Starting…">{label}</SubmitButton>
        </>
      )}
    </form>
  );
}
