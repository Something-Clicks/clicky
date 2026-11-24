import type { Metadata } from "next";

import { NOINDEX } from "@/config/seo";

import { getStartFlow } from "@/lib/start-flow";

import { SignupForm } from "./signup-form";

// Sign-in pages are public but not search results.
export const metadata: Metadata = { title: "Sign up", robots: NOINDEX, alternates: { canonical: "/signup" } };

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
