import type { Metadata } from "next";

import { safeNextPath } from "@/lib/redirect";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const params = await searchParams;
  return (
    <>
      <div className="eyebrow">Welcome back</div>
      <h1 className="h1">Let&apos;s make marketing click.</h1>
      <p className="sub">Sign in to see your next step.</p>
      <LoginForm next={safeNextPath(params.next)} linkError={params.error === "link"} />
    </>
  );
}
