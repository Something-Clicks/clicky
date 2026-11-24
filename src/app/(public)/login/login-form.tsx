"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { sendSignInLink, signIn } from "@/app/actions/auth";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function LoginForm({ next, linkError }: { next: string; linkError: boolean }) {
  const [state, action] = useActionState(signIn, {} as FormState);
  const [linkState, linkAction] = useActionState(sendSignInLink, {} as FormState);
  const [mode, setMode] = useState<"password" | "link">("password");
  return (
    <div className="card" data-clarity-mask="true">
      {linkError && !state.error ? (
        <p className="notice error" role="alert">
          That link has expired or was already used. Sign in, or ask for a new link.
        </p>
      ) : null}
      {mode === "password" ? (
        <form action={action} noValidate>
          <FormMessage state={state} />
          <input type="hidden" name="next" value={next} />
          <Field label="Email" name="email" type="email" placeholder="you@example.com" autoComplete="email" state={state} required />
          <Field label="Password" name="password" type="password" autoComplete="current-password" state={state} required />
          <SubmitButton pending="Signing in…">Sign in</SubmitButton>
          <p className="small" style={{ marginTop: 12 }}>
            <button type="button" className="link" onClick={() => setMode("link")}>
              Email me a sign-in link instead
            </button>
          </p>
        </form>
      ) : (
        <form action={linkAction} noValidate>
          <FormMessage state={linkState} />
          <input type="hidden" name="next" value={next} />
          <Field label="Email" name="email" type="email" placeholder="you@example.com" autoComplete="email" state={linkState} required />
          <SubmitButton pending="Sending…">Email me a link</SubmitButton>
          <p className="small" style={{ marginTop: 12 }}>
            <button type="button" className="link" onClick={() => setMode("password")}>
              Use my password instead
            </button>
          </p>
        </form>
      )}
      <p className="small muted">
        <Link className="link" href="/forgot-password">
          Forgot your password?
        </Link>{" "}
        · New here?{" "}
        <Link className="link" href="/">
          Start free.
        </Link>
      </p>
    </div>
  );
}
