"use client";

import { useActionState, useEffect, useState } from "react";

import { savePreview, sendFeedback } from "@/app/actions/start";
import { FormMessage, SubmitButton } from "@/components/form";
import { TrackEvent } from "@/components/track-event";
import type { FormState } from "@/lib/validation";

/** Steps shown while the analysis runs. Advances on a timer; the page refreshes for the real status. */
const STEPS = ["Opening your homepage", "Reading your key pages", "Checking mobile speed", "Writing your plan"];
export function WorkingSteps() {
  const [on, setOn] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setOn((n) => Math.min(n + 1, STEPS.length - 1)), 6000);
    return () => clearInterval(t);
  }, []);
  return (
    <ol aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s} className={i <= on ? "on" : undefined} aria-current={i === on ? "step" : undefined}>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function SaveThis({ domain }: { domain: string }) {
  const [state, action] = useActionState(savePreview, {} as FormState);
  if (state.ok) {
    return (
      <div className="card" role="status">
        <h2>Check your email</h2>
        <p>We sent a link to <b>{state.values?.email}</b>. Open it on any device to save your results for {domain}.</p>
        <p className="muted small">The link works once and expires in 24 hours.</p>
      </div>
    );
  }
  return (
    <form data-clarity-mask="true" className="card" action={action} noValidate aria-labelledby="save-title">
      <h2 id="save-title">Save this</h2>
      <p className="muted">Get your results in your own account, plus two more free uses.</p>
      <FormMessage state={state} />
      <div className="trap" aria-hidden="true">
        <label>
          Company <input name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="field">
        <label htmlFor="f-save-email">Email</label>
        <input
          id="f-save-email"
          className="input"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@yourbusiness.com"
          defaultValue={state.values?.email}
          aria-invalid={state.fieldErrors?.email ? true : undefined}
          aria-describedby={state.fieldErrors?.email ? "f-save-email-error" : undefined}
          required
        />
        {state.fieldErrors?.email ? (
          <span className="error" id="f-save-email-error" role="alert">
            {state.fieldErrors.email}
          </span>
        ) : null}
      </div>
      <SubmitButton pending="Sending your link…">Email me a link</SubmitButton>
    </form>
  );
}

export function Thumbs() {
  const [state, action] = useActionState(sendFeedback, {} as FormState);
  const [rating, setRating] = useState<"" | "up" | "down">("");
  if (state.ok) {
    return (
      <>
        <TrackEvent name="feedback_submitted" id="first_result" params={{ kind: "first_result" }} />
        <p className="notice success" role="status">
          {state.message}
        </p>
      </>
    );
  }
  return (
    <form data-clarity-mask="true" className="card quiet" action={action} aria-labelledby="thumbs-title">
      <input type="hidden" name="kind" value="first_result" />
      <input type="hidden" name="rating" value={rating} />
      <div className="trap" aria-hidden="true">
        <input name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <div className="between">
        <p id="thumbs-title" style={{ margin: 0, fontWeight: 600 }}>
          Was this useful?
        </p>
        <div className="thumbs">
          <button type="button" aria-label="Yes, useful" aria-pressed={rating === "up"} onClick={() => setRating("up")}>
            👍
          </button>
          <button type="button" aria-label="Not useful" aria-pressed={rating === "down"} onClick={() => setRating("down")}>
            👎
          </button>
        </div>
      </div>
      {rating ? (
        <div style={{ marginTop: 12 }}>
          <FormMessage state={state} />
          <div className="field">
            <label htmlFor="f-thumbs-reason">Anything to add? (optional)</label>
            <textarea id="f-thumbs-reason" name="reason" maxLength={500} />
          </div>
          <SubmitButton pending="Sending…">Send</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
