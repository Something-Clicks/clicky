"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { startAnalysis } from "@/app/actions/intelligence";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

export function RunAnalysisButton({ label = "Run analysis", disabled = false }: { label?: string; disabled?: boolean }) {
  const [state, action] = useActionState(startAnalysis, {} as FormState);
  return (
    <form action={action}>
      <FormMessage state={state} />
      {disabled ? (
        <button className="btn" type="button" disabled aria-disabled="true">
          Analyzing…
        </button>
      ) : (
        <SubmitButton pending="Starting…">{label}</SubmitButton>
      )}
    </form>
  );
}

/** While an analysis runs, re-fetch the page every few seconds (no fake progress bar). */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
