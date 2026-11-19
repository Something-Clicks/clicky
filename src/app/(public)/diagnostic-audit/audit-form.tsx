"use client";

import { useActionState } from "react";

import { startAudit } from "@/app/actions/audit";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

const GOALS = [
  { value: "get_found", label: "Getting found by more customers" },
  { value: "more_calls", label: "Turning visits into calls" },
  { value: "understand", label: "Understanding what is working" },
  { value: "not_sure", label: "Not sure yet" },
] as const;

export function AuditForm({ price }: { price: string }) {
  const [state, action] = useActionState(startAudit, {} as FormState);
  return (
    <form className="card" style={{ maxWidth: 700 }} action={action} noValidate>
      <FormMessage state={state} />
      <Field label="Business name" name="businessName" placeholder="Your business" autoComplete="organization" state={state} required />
      <Field label="Website" name="website" placeholder="https://example.com" inputMode="url" state={state} />
      <Field label="What would you most like to improve?" name="primaryGoal" options={GOALS} state={state} />
      <Field label="Email" name="email" type="email" placeholder="you@example.com" autoComplete="email" state={state} required />
      <SubmitButton pending="Continuing…">Continue to secure checkout · {price}</SubmitButton>
      <p className="small muted">Next, you&apos;ll create your account. Payment is handled securely by Stripe.</p>
    </form>
  );
}
