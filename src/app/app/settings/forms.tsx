"use client";

import { useActionState } from "react";

import { updateBusiness, updateNotifications, updateProfile } from "@/app/actions/workspace";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
  const [state, action] = useActionState(updateProfile, {} as FormState);
  return (
    <form data-clarity-mask="true" className="card" action={action} noValidate>
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
  recurring,
}: {
  canEdit: boolean;
  businessName: string;
  website: string;
  recurring: boolean;
}) {
  const [state, action] = useActionState(updateBusiness, {} as FormState);
  return (
    <form data-clarity-mask="true" className="card" action={action} noValidate>
      <h3>Business profile</h3>
      <FormMessage state={state} />
      {!canEdit ? <p className="notice">Only the account owner can change the business profile.</p> : null}
      <Field label="Business name" name="businessName" placeholder="Business name" defaultValue={businessName} state={state} disabled={!canEdit} required />
      <Field label="Website" name="website" placeholder="https://" inputMode="url" defaultValue={website} state={state} disabled={!canEdit} />
      <Check name="recurring" label="Check my website again every week" defaultChecked={recurring} disabled={!canEdit} />
      {canEdit ? <SubmitButton pending="Saving…">Save</SubmitButton> : null}
    </form>
  );
}

function Check({ name, label, defaultChecked, disabled }: { name: string; label: string; defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className="field" style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} style={{ width: 18, height: 18 }} />
      <span style={{ margin: 0, fontWeight: 400, fontSize: 14 }}>{label}</span>
    </label>
  );
}

export function NotificationsForm({ draftReady, analysisComplete, isOwner, emailReady, showDrafts }: { draftReady: boolean; analysisComplete: boolean; isOwner: boolean; emailReady: boolean; showDrafts: boolean }) {
  const [state, action] = useActionState(updateNotifications, {} as FormState);
  return (
    <form data-clarity-mask="true" className="card" action={action}>
      <h3>Notifications</h3>
      <p className="muted">Choose when to receive updates.</p>
      <FormMessage state={state} />
      {showDrafts && isOwner ? <Check name="draft_ready" label="Email me when a draft is ready for my approval" defaultChecked={draftReady} /> : null}
      <Check name="analysis_complete" label="Email me when a website check is ready" defaultChecked={analysisComplete} />
      {emailReady ? null : <p className="small muted">Email sending is being set up. Your choices are saved now and used once it&apos;s on.</p>}
      <SubmitButton pending="Saving…">Save preferences</SubmitButton>
    </form>
  );
}
