"use client";

import { useActionState } from "react";

import { startFirstUse } from "@/app/actions/start";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

/** Website + ZIP, the first action on the homepage. */
export function StartForm({ ticket, cta = "Check my website" }: { ticket: string; cta?: string }) {
  const [state, action] = useActionState(startFirstUse, {} as FormState);
  const err = state.fieldErrors ?? {};
  return (
    <form className="start-form" action={action} noValidate aria-label="Check your website">
      <div className="form-msg" style={state.error ? undefined : { display: "none" }}>
        <FormMessage state={state} />
      </div>
      <input type="hidden" name="ticket" value={ticket} />
      <div className="trap" aria-hidden="true">
        <label>
          Company <input name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="field">
        <label htmlFor="f-website">Website</label>
        <input
          id="f-website"
          className="input"
          name="website"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="yourbusiness.com"
          defaultValue={state.values?.website}
          aria-invalid={err.website ? true : undefined}
          aria-describedby={err.website ? "f-website-error" : undefined}
          required
        />
        {err.website ? (
          <span className="error" id="f-website-error" role="alert">
            {err.website}
          </span>
        ) : null}
      </div>
      <div className="field zip">
        <label htmlFor="f-zip">ZIP code</label>
        <input
          id="f-zip"
          className="input"
          name="zipCode"
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          pattern="[0-9]{5}"
          maxLength={5}
          placeholder="75201"
          defaultValue={state.values?.zipCode}
          aria-invalid={err.zipCode ? true : undefined}
          aria-describedby={err.zipCode ? "f-zip-error" : undefined}
          required
        />
        {err.zipCode ? (
          <span className="error" id="f-zip-error" role="alert">
            {err.zipCode}
          </span>
        ) : null}
      </div>
      <SubmitButton pending="Starting…">{cta}</SubmitButton>
    </form>
  );
}
