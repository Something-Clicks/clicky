import type { Metadata } from "next";

import { getWorkspace } from "@/lib/auth";
import { getStartFlow } from "@/lib/start-flow";

import { BusinessSetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const workspace = await getWorkspace();
  const b = workspace.business;
  const start = workspace.organization ? null : await getStartFlow();
  return (
    <>
      <div className="eyebrow">Welcome</div>
      <h1 className="h1">Let&apos;s get your business connected.</h1>
      <p className="sub">A few details help us make your first analysis useful.</p>
      <BusinessSetupForm
        existing={Boolean(workspace.organization)}
        canEdit={!workspace.organization || workspace.organization.role === "owner"}
        defaults={{
          businessName: b?.businessName ?? start?.businessName ?? "",
          website: b?.website ?? start?.website ?? "",
          serviceArea: b?.serviceArea ?? "",
          primaryGoal: b?.primaryGoal ?? (start?.primaryGoal || "get_found"),
        }}
      />
    </>
  );
}
