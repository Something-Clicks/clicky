"use client";

import { useActionState, useState } from "react";

import { decideApproval } from "@/app/actions/drafts";
import { FormMessage } from "@/components/form";
import type { FormState } from "@/lib/validation";

/** Approve / Request changes / Reject, in the reference's button row. Owner only (also enforced on the server). */
export function ApprovalActions({ approvalId, versionId, children }: { approvalId: string; /** The version the owner is looking at: approving approves exactly this one. */ versionId?: string | null; children?: React.ReactNode }) {
  const [state, action, pending] = useActionState(decideApproval, {} as FormState);
  const [asking, setAsking] = useState(false);
  if (state.ok) return <FormMessage state={state} />;
  return (
    <form data-clarity-mask="true" action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={approvalId} />
      {versionId ? <input type="hidden" name="version" value={versionId} /> : null}
      {asking ? (
        <label className="field" htmlFor={`note-${approvalId}`}>
          <span>What should change?</span>
          <textarea id={`note-${approvalId}`} name="note" className="input" rows={3} maxLength={1000} required
            aria-invalid={state.fieldErrors?.note ? true : undefined} />
          {state.fieldErrors?.note ? <span className="error" role="alert">{state.fieldErrors.note}</span> : null}
        </label>
      ) : null}
      <div className="row" style={{ marginTop: 16 }}>
        {asking ? (
          <>
            <button className="btn" type="submit" name="decision" value="changes_requested" disabled={pending}>
              Send changes
            </button>
            <button className="btn outline" type="button" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn" type="submit" name="decision" value="approved" disabled={pending}>
              Approve
            </button>
            {children}
            <button className="btn outline" type="button" onClick={() => setAsking(true)}>
              Request changes
            </button>
            <button className="btn outline" type="submit" name="decision" value="rejected" disabled={pending}>
              Reject
            </button>
          </>
        )}
      </div>
    </form>
  );
}
