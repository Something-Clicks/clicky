import type { Metadata } from "next";

import { getStartFlow } from "@/lib/start-flow";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage() {
  const start = await getStartFlow();
  const site = start ? new URL(start.website).hostname.replace(/^www\./, "") : null;
  return (
    <div className="narrow">
      <h1 className="h1">{site ? `Let's check ${site}` : "Create your free account"}</h1>
      <p className="sub">Three free uses. No card needed.</p>
      <SignupForm />
    </div>
  );
}
