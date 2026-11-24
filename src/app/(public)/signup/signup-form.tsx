"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signUp } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function SignupForm({ email = "" }: { email?: string }) {
  const [state, action] = useActionState(signUp, {} as FormState);
  if (state.ok) {
    return (
      <div className="card">
        <FormMessage state={state} />
        <p className="small muted">Open the link to continue. It works on any device.</p>
      </div>
    );
  }
  return (
    <form className="card" action={action} noValidate data-clarity-mask="true">
      <FormMessage state={state} />
      <Field label="Name" name="fullName" placeholder="Your name" autoComplete="name" state={state} required />
      <Field label="Email" name="email" type="email" placeholder="you@example.com" autoComplete="email" defaultValue={email} state={state} required />
      <Field
        label="Password"
        name="password"
        type="password"
        placeholder="At least 8 characters"
        autoComplete="new-password"
        state={state}
        required
      />
      <SubmitButton pending="Creating your account…">Create account</SubmitButton>
      <p className="small muted">
        Already have an account?{" "}
        <Link className="link" href="/login">
          Sign in.
        </Link>
      </p>
    </form>
  );
}
