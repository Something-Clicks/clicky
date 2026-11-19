"use client";

import { useActionState } from "react";

import { openBillingPortal, startCheckout } from "@/app/actions/billing";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function CheckoutButton({ plan, label, variant }: { plan: string; label: string; variant?: "light" }) {
  const [state, action] = useActionState(startCheckout, {} as FormState);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="plan" value={plan} />
      {variant ? (
        <PlainSubmit className={`btn ${variant}`}>{label}</PlainSubmit>
      ) : (
        <SubmitButton pending="Opening secure checkout…">{label}</SubmitButton>
      )}
    </form>
  );
}

export function PortalButton() {
  const [state, action] = useActionState(openBillingPortal, {} as FormState);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <PlainSubmit className="btn outline">Manage billing</PlainSubmit>
    </form>
  );
}

function PlainSubmit({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <button className={className} type="submit">
      {children}
    </button>
  );
}
