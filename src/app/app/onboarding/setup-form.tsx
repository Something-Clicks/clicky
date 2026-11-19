"use client";

import { useActionState } from "react";

import { saveBusinessSetup } from "@/app/actions/workspace";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { GOALS, type FormState } from "@/lib/validation";

export function BusinessSetupForm({
  existing,
  canEdit,
  defaults,
}: {
  existing: boolean;
  canEdit: boolean;
  defaults: Record<"businessName" | "website" | "serviceArea" | "primaryGoal", string>;
}) {
  const [state, action] = useActionState(saveBusinessSetup, {} as FormState);
  return (
    <form className="card" style={{ maxWidth: 760 }} action={action} noValidate>
      <div className="row between">
        <b>Business setup</b>
        <span className="pill">Step 1 of 3</span>
      </div>
      <div className="bar" style={{ margin: "12px 0 20px" }}>
        <i style={{ width: "34%" }} />
      </div>
      <FormMessage state={state} />
      {!canEdit ? <p className="notice">Only the account owner can change these details.</p> : null}
      <Field label="Business name" name="businessName" placeholder="Business name" autoComplete="organization" defaultValue={defaults.businessName} state={state} disabled={!canEdit} required />
      <Field label="Website" name="website" placeholder="https://" inputMode="url" defaultValue={defaults.website} state={state} disabled={!canEdit} />
      <Field label="Where do you serve customers?" name="serviceArea" placeholder="City, region, or service area" defaultValue={defaults.serviceArea} state={state} disabled={!canEdit} />
      <Field label="What matters most right now?" name="primaryGoal" options={GOALS} defaultValue={defaults.primaryGoal} state={state} disabled={!canEdit} />
      {canEdit ? <SubmitButton pending="Saving…">{existing ? "Save changes" : "Save and continue"}</SubmitButton> : null}
    </form>
  );
}
