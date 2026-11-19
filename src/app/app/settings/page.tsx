import type { Metadata } from "next";
import Link from "next/link";

import { SoonButton } from "@/components/soon";
import { requireOrganization } from "@/lib/auth";

import { BusinessForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ws = await requireOrganization();
  return (
    <>
      <div className="eyebrow">Your account</div>
      <h1 className="h1">Settings</h1>
      <p className="sub">Manage your profile, business, team access, and preferences.</p>
      <div className="grid two">
        <ProfileForm fullName={ws.fullName ?? ""} email={ws.email} />
        <BusinessForm
          canEdit={ws.organization.role === "owner"}
          businessName={ws.business?.businessName ?? ""}
          website={ws.business?.website ?? ""}
        />
        <div className="card">
          <h3>Members</h3>
          <p className="muted">Invite people and choose their organization role.</p>
          <Link className="btn light" href="/app/settings/members">
            Manage members
          </Link>
        </div>
        <div className="card">
          <h3>Notifications</h3>
          <p className="muted">Choose when to receive updates about actions and approvals.</p>
          <SoonButton variant="light" reason="Notifications arrive with activity updates">
            Notification preferences
          </SoonButton>
        </div>
      </div>
    </>
  );
}
