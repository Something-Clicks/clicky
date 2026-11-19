import type { Metadata } from "next";

import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <>
      <div className="eyebrow">Welcome</div>
      <h1 className="h1">Let&apos;s make marketing click.</h1>
      <p className="sub">Create your account to see your next step.</p>
      <SignupForm />
    </>
  );
}
