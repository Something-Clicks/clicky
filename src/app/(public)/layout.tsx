import Link from "next/link";

import { Shell } from "@/components/shell";
import { getUser } from "@/lib/auth";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  let signedIn = false;
  try {
    signedIn = Boolean(await getUser());
  } catch {
    // Supabase not configured (e.g. a static preview): show the signed-out state.
  }

  return (
    <Shell
      crumbRoot="Something Clicks"
      crumbs={{
        "/": "Home",
        "/how-it-works": "How it works",
        "/pricing": "Pricing",
        "/diagnostic-audit": "Diagnostic audit",
        "/about": "About",
        "/faq": "FAQ",
        "/login": "Log in",
        "/forgot-password": "Reset password",
        "/reset-password": "Choose a new password",
        "/signup": "Sign up",
      }}
      groups={[
        {
          label: "PUBLIC WEBSITE",
          items: [
            { href: "/", label: "Home", exact: true },
            { href: "/how-it-works", label: "How it works" },
            { href: "/pricing", label: "Pricing" },
            { href: "/diagnostic-audit", label: "Diagnostic audit" },
            { href: "/about", label: "About" },
            { href: "/faq", label: "FAQ" },
          ],
        },
        {
          label: "ACCOUNT",
          items: signedIn
            ? [{ href: "/app", label: "Your workspace" }]
            : [
                { href: "/login", label: "Log in" },
                { href: "/signup", label: "Sign up" },
              ],
        },
      ]}
      right={
        signedIn ? (
          <Link className="btn light" href="/app">
            Your workspace
          </Link>
        ) : (
          <Link className="btn light" href="/login">
            Log in
          </Link>
        )
      }
    >
      {children}
    </Shell>
  );
}
