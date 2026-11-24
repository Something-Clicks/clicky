import type { Metadata } from "next";
import Image from "next/image";

import { getWorkspace } from "@/lib/auth";
import { getStartFlow } from "@/lib/start-flow";

import { BusinessSetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Your business" };
export const maxDuration = 120;

export default async function OnboardingPage() {
  const workspace = await getWorkspace();
  const b = workspace.business;
  const start = workspace.organization ? null : await getStartFlow();
  return (
    <div className="narrow stack">
      <Image src="/brand/clicky-3d.png" alt="" width={720} height={502} style={{ width: 140 }} priority />
      <div>
        <h1 className="h1">{workspace.organization ? "Your business" : "Almost there"}</h1>
        <p className="sub">{workspace.organization ? "Update your details." : "Tell us your business name and we'll check your website."}</p>
      </div>
      <BusinessSetupForm
        existing={Boolean(workspace.organization)}
        canEdit={!workspace.organization || workspace.organization.role === "owner"}
        defaults={{
          businessName: b?.businessName ?? "",
          website: b?.website ?? start?.website ?? "",
          zipCode: start?.zipCode ?? "",
        }}
      />
    </div>
  );
}
