"use client";

import { useActionState } from "react";

import { preparePlan } from "@/app/actions/plan";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

/** Prepare a plan, or revise the current one with the owner's own notes. Nothing is applied until the owner approves. */
export function PlanForm({ revising, canTakeNotes = true }: { revising: boolean; canTakeNotes?: boolean }) {
  const [state, action] = useActionState(preparePlan, {} as FormState);
  return (
    <form data-clarity-mask="true" action={action} className="stack">
      <FormMessage state={state} />
      {revising && canTakeNotes ? (
        <label className="field" htmlFor="plan-notes">
          <span>What should change?</span>
          <textarea id="plan-notes" name="notes" className="input" rows={3} maxLength={600} placeholder="For example: we can't take on weekend jobs, so focus on weekday customers." required />
        </label>
      ) : null}
      <div>
        <SubmitButton pending="Preparing your plan… this can take up to a minute">{revising ? (canTakeNotes ? "Revise the plan" : "Refresh the plan") : "Prepare my plan"}</SubmitButton>
      </div>
    </form>
  );
}
