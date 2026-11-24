"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordReset } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState(requestPasswordReset, {} as FormState);
  return (
    <>
      <h1 className="h1">Reset your password</h1>
      <p className="sub">Enter your email and we&apos;ll send you a link to choose a new password.</p>
      <form className="card" action={action} noValidate data-clarity-mask="true">
        <FormMessage state={state} />
        {state.ok ? null : (
          <>
            <Field label="Email" name="email" type="email" placeholder="you@example.com" autoComplete="email" state={state} required />
            <SubmitButton pending="Sending…">Send reset link</SubmitButton>
          </>
        )}
        <p className="small muted">
          Remembered it?{" "}
          <Link className="link" href="/login">
            Sign in.
          </Link>
        </p>
      </form>
    </>
  );
}
