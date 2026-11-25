import type { Metadata } from "next";
import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { Shell } from "@/components/shell";
import { TrackEvent } from "@/components/track-event";
import { FEATURES } from "@/config/features";
import { getWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const NAV = [
  { href: "/app", label: "Home", exact: true },
  { href: "/app/actions", label: "To do" },
  { href: "/app/analysis", label: "Website check" },
  { href: "/app/activity", label: "History" },
  { href: "/app/billing", label: "Plan" },
  { href: "/app/settings", label: "Settings" },
];
const TABS = [
  { href: "/app", label: "Home", icon: "⌂", exact: true },
  { href: "/app/actions", label: "To do", icon: "✓" },
  { href: "/app/analysis", label: "Check", icon: "◎" },
  { href: "/app/settings", label: "Account", icon: "☺" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const workspace = await getWorkspace();
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("current_user_is_platform_admin");
  const initial = (workspace.fullName || workspace.email || "?").trim().charAt(0).toUpperCase();

  return (
    <Shell
      groups={[
        // "Business details" and "Your plan" appear only where their switches are on (never in Production).
        { label: workspace.business?.businessName ?? "Your business", items: [...NAV.slice(0, 3), ...(FEATURES.businessProfile ? [{ href: "/app/business", label: "Business details" }] : []), ...(FEATURES.strategy ? [{ href: "/app/plan", label: "Your plan" }] : []), ...NAV.slice(3)] },
        ...(isAdmin === true ? [{ label: "Platform", items: [{ href: "/admin", label: "Admin" }] }] : []),
      ]}
      tabs={TABS}
      right={
        <Link className="avatar" href="/app/settings" aria-label="Your account">
          {initial}
        </Link>
      }
      sideFooter={
        <form data-clarity-mask="true" action={signOut}>
          <button className="nav" type="submit" style={{ border: 0, background: "none", font: "inherit", cursor: "pointer", width: "100%", textAlign: "left" }}>
            Sign out
          </button>
        </form>
      }
    >
      <TrackEvent name="sign_in" />
      {children}
    </Shell>
  );
}
