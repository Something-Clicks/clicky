"use client";

import { useActionState } from "react";

import { saveBusinessSetup } from "@/app/actions/workspace";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function BusinessSetupForm({
  existing,
  canEdit,
  defaults,
}: {
  existing: boolean;
  canEdit: boolean;
  defaults: Record<"businessName" | "website" | "zipCode", string>;
}) {
  const [state, action] = useActionState(saveBusinessSetup, {} as FormState);
  return (
    <form className="card" action={action} noValidate>
      <FormMessage state={state} />
      {!canEdit ? <p className="notice">Only the account owner can change these details.</p> : null}
      <Field label="Business name" name="businessName" placeholder="Sunrise Plumbing" autoComplete="organization" defaultValue={defaults.businessName} state={state} disabled={!canEdit} required />
      <Field label="Website" name="website" placeholder="yourbusiness.com" inputMode="url" autoComplete="url" defaultValue={defaults.website} state={state} disabled={!canEdit} />
      <Field label="ZIP code" name="zipCode" placeholder="75201" inputMode="numeric" autoComplete="postal-code" defaultValue={defaults.zipCode} state={state} disabled={!canEdit} />
      {canEdit ? <SubmitButton pending="Saving…">{existing ? "Save changes" : "Check my website"}</SubmitButton> : null}
    </form>
  );
}
