"use client";

import Link from "next/link";
import { useActionState } from "react";

import { updatePassword } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

/** New password + confirmation. Used after a reset link and in Settings. */
export function PasswordForm({ title, afterSuccess }: { title?: string; afterSuccess?: { href: string; label: string } }) {
  const [state, action] = useActionState(updatePassword, {} as FormState);
  return (
    <form data-clarity-mask="true" className="card" style={title ? undefined : { maxWidth: 480 }} action={action} noValidate>
      {title ? <h3>{title}</h3> : null}
      <FormMessage state={state} />
      {state.ok && afterSuccess ? (
        <Link className="btn" href={afterSuccess.href}>
          {afterSuccess.label}
        </Link>
      ) : (
        <>
          <Field label="New password" name="password" type="password" placeholder="At least 8 characters" autoComplete="new-password" state={state} required />
          <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" state={state} required />
          <SubmitButton pending="Saving…">Change password</SubmitButton>
        </>
      )}
    </form>
  );
}
