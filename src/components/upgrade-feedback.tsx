"use client";

import { useActionState } from "react";

import { sendFeedback } from "@/app/actions/start";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

/** "What stopped you?" Optional, short, and the follow-up email is opt-in for one message only. */
export function UpgradeFeedback() {
  const [state, action] = useActionState(sendFeedback, {} as FormState);
  if (state.ok) {
    return (
      <p className="notice success" role="status">
        {state.message}
      </p>
    );
  }
  return (
    <form className="card quiet" action={action} aria-labelledby="stop-title">
      <h2 id="stop-title" style={{ fontSize: 18 }}>
        What stopped you?
      </h2>
      <p className="muted small">Optional. One line is plenty.</p>
      <FormMessage state={state} />
      <input type="hidden" name="kind" value="upgrade" />
      <input type="hidden" name="rating" value="" />
      <div className="trap" aria-hidden="true">
        <input name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <div className="field">
        <label htmlFor="f-stop-reason">Your answer</label>
        <textarea id="f-stop-reason" name="reason" maxLength={500} defaultValue={state.values?.reason} />
        {state.fieldErrors?.reason ? <span className="error">{state.fieldErrors.reason}</span> : null}
      </div>
      <label className="check">
        <input type="checkbox" name="followup" />
        <span>Okay to email me one follow-up.</span>
      </label>
      <SubmitButton pending="Sending…">Send</SubmitButton>
    </form>
  );
}
