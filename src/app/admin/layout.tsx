import type { Metadata } from "next";

import { signOut } from "@/app/actions/auth";
import { Shell } from "@/components/shell";
import { requirePlatformAdmin } from "@/lib/auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return (
    <Shell
      groups={[
        {
          label: "Admin",
          items: [
            { href: "/admin", label: "Overview", exact: true },
            { href: "/admin/funnel", label: "Funnel and feedback" },
            { href: "/admin/agent-runs", label: "Draft runs" },
          ],
        },
        { label: "Customer app", items: [{ href: "/app", label: "Back to workspace" }] },
      ]}
      tabs={[
        { href: "/admin", label: "Overview", icon: "◎", exact: true },
        { href: "/admin/funnel", label: "Funnel", icon: "▤" },
        { href: "/admin/agent-runs", label: "Runs", icon: "↻" },
        { href: "/app", label: "App", icon: "⌂" },
      ]}
      right={<span className="pill coral">Admin · every view is logged</span>}
      sideFooter={
        <>
          <form data-clarity-mask="true" action={signOut}>
            <button className="nav" type="submit" style={{ border: 0, background: "none", font: "inherit", cursor: "pointer" }}>
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
