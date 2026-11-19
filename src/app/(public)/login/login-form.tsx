"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signIn } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const [state, action] = useActionState(signIn, {} as FormState);
  return (
    <form className="card" style={{ maxWidth: 480 }} action={action} noValidate>
      {linkError && !state.error ? (
        <p className="notice error" role="alert">
          That link has expired or was already used. Sign in, or sign up again.
        </p>
      ) : null}
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next} />
      <Field label="Email" name="email" type="email" placeholder="you@example.com" autoComplete="email" state={state} required />
      <Field label="Password" name="password" type="password" placeholder="Password" autoComplete="current-password" state={state} required />
      <SubmitButton pending="Signing in…">Sign in</SubmitButton>
      <p className="small muted">
        <Link className="link" href="/forgot-password">
          Forgot your password?
        </Link>
      </p>
      <p className="small muted">
        New here?{" "}
        <Link className="link" href="/signup">
          Create an account.
        </Link>
      </p>
    </form>
  );
}
