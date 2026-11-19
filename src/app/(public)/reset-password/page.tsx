import type { Metadata } from "next";
import Link from "next/link";

import { PasswordForm } from "@/components/password-form";
import { getUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage() {
  const user = await getUser();
  return (
    <>
      <div className="eyebrow">Reset your password</div>
      <h1 className="h1">Choose a new password.</h1>
      <p className="sub">Use at least 8 characters.</p>
      {user ? (
        <PasswordForm afterSuccess={{ href: "/app", label: "Go to your workspace" }} />
      ) : (
        <div className="card" style={{ maxWidth: 480 }}>
          <p className="notice error" role="alert">
            This reset link has expired or was already used.
          </p>
          <Link className="btn" href="/forgot-password">
            Send a new link
          </Link>
        </div>
      )}
    </>
  );
}
