import type { Metadata } from "next";

import { signOut } from "@/app/actions/auth";
import { Shell } from "@/components/shell";
import { requirePlatformAdmin } from "@/lib/auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return (
    <Shell
      crumbRoot="Platform"
      crumbs={{ "/admin": "Admin overview", "/admin/agent-runs": "Agent runs" }}
      groups={[
        {
          label: "ADMIN",
          items: [
            { href: "/admin", label: "Overview", exact: true },
            { href: "/admin/agent-runs", label: "Agent runs" },
          ],
        },
        { label: "CUSTOMER APP", items: [{ href: "/app", label: "Back to workspace" }] },
      ]}
      right={<span className="pill coral">Admin · every view is logged</span>}
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
