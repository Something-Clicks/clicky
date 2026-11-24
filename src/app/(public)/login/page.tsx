import type { Metadata } from "next";

import { safeNextPath } from "@/lib/redirect";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const params = await searchParams;
  const claiming = params.claim === "1";
  return (
    <div className="narrow">
      <h1 className="h1">{claiming ? "Sign in to save your results" : "Welcome back"}</h1>
      <p className="sub">
        {claiming ? "Use the same email you entered when you saved them." : "Sign in to pick up where you left off."}
      </p>
      <LoginForm next={safeNextPath(params.next)} linkError={params.error === "link"} />
    </div>
  );
}
