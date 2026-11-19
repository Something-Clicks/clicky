import type { Metadata } from "next";

import { getStartFlow } from "@/lib/start-flow";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Sign up" };

export default async function SignupPage() {
  const start = await getStartFlow();
  return (
    <>
      <div className="eyebrow">Welcome</div>
      <h1 className="h1">Let&apos;s make marketing click.</h1>
      <p className="sub">
        {start ? "Create your account, then you'll check out for your Diagnostic Audit." : "Create your account to see your next step."}
      </p>
      <SignupForm email={start?.email ?? ""} />
    </>
  );
}
