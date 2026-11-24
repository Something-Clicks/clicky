"use client";

import { useActionState } from "react";

import { openBillingPortal, startCheckout } from "@/app/actions/billing";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function CheckoutButton({ plan, interval, label, variant }: { plan: string; interval: string; label: string; variant?: "light" }) {
  const [state, action] = useActionState(startCheckout, {} as FormState);
  return (
    <form action={action}>
      <FormMessage state={state} />
      <input type="hidden" name="plan" value={plan} />
      <input type="hidden" name="interval" value={interval} />
      {variant ? (
        <button className={`btn block ${variant}`} type="submit">
          {label}
        </button>
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
      <button className="btn outline" type="submit">
        Manage billing
      </button>
    </form>
  );
}
