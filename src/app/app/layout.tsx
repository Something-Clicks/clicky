import type { Metadata } from "next";
import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { Shell } from "@/components/shell";
import { getWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const APP_NAV = [
  { href: "/app/onboarding", label: "Onboarding" },
  { href: "/app", label: "Dashboard", exact: true },
  { href: "/app/actions", label: "Action cards" },
  { href: "/app/analysis", label: "Analysis" },
  { href: "/app/connections", label: "Connections" },
  { href: "/app/approvals", label: "Approvals" },
  { href: "/app/activity", label: "Activity" },
  { href: "/app/billing", label: "Billing" },
  { href: "/app/settings", label: "Settings" },
];

const CRUMBS: Record<string, string> = {
  "/app": "Dashboard",
  "/app/onboarding": "Onboarding",
  "/app/actions": "Action cards",
  "/app/analysis": "Analysis",
  "/app/connections": "Connections",
  "/app/approvals": "Approvals",
  "/app/activity": "Activity",
  "/app/billing": "Billing",
  "/app/settings": "Settings",
  "/app/settings/members": "Members",
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("current_user_is_platform_admin");
  const initial = (workspace.fullName || workspace.email || "?").trim().charAt(0).toUpperCase();

  return (
    <Shell
      crumbRoot={workspace.business?.businessName ?? "Your workspace"}
      crumbs={CRUMBS}
      groups={[
        { label: "CUSTOMER APP", items: APP_NAV },
        ...(isAdmin === true ? [{ label: "PLATFORM", items: [{ href: "/admin", label: "Admin" }] }] : []),
      ]}
      right={
        <Link className="avatar" href="/app/settings" aria-label="Your settings" style={{ textDecoration: "none" }}>
          {initial}
        </Link>
      }
      sideFooter={
        <>
          <div className="group">ACCOUNT</div>
          <form action={signOut}>
            <button className="nav" type="submit">
              Sign out
            </button>
          </form>
        </>
      }
    >
      {children}
    </Shell>
  );
}
