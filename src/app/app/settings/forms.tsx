"use client";

import { useActionState } from "react";

import { updateBusiness, updateProfile } from "@/app/actions/workspace";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [state, action] = useActionState(updateProfile, {} as FormState);
  return (
    <form className="card" action={action} noValidate>
      <h3>Personal profile</h3>
      <FormMessage state={state} />
      <Field label="Name" name="fullName" placeholder="Your name" autoComplete="name" defaultValue={fullName} state={state} required />
      <Field label="Email" name="email" type="email" placeholder="you@example.com" defaultValue={email} disabled />
      <SubmitButton pending="Saving…">Save</SubmitButton>
    </form>
  );
}

export function BusinessForm({
  canEdit,
  businessName,
  website,
}: {
  canEdit: boolean;
  businessName: string;
  website: string;
}) {
  const [state, action] = useActionState(updateBusiness, {} as FormState);
  return (
    <form className="card" action={action} noValidate>
      <h3>Business profile</h3>
      <FormMessage state={state} />
      {!canEdit ? <p className="notice">Only the account owner can change the business profile.</p> : null}
      <Field label="Business name" name="businessName" placeholder="Business name" defaultValue={businessName} state={state} disabled={!canEdit} required />
      <Field label="Website" name="website" placeholder="https://" inputMode="url" defaultValue={website} state={state} disabled={!canEdit} />
      {canEdit ? <SubmitButton pending="Saving…">Save</SubmitButton> : null}
    </form>
  );
}
