import type { Metadata } from "next";
import Link from "next/link";

import { PasswordForm } from "@/components/password-form";
import { requireOrganization } from "@/lib/auth";
import { isEmailConfigured } from "@/lib/server/notify";
import { createClient } from "@/lib/supabase/server";

import { BusinessForm, NotificationsForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ws = await requireOrganization();
  const supabase = await createClient();
  const [{ data: prefs }, { data: org }] = await Promise.all([
    supabase.from("notification_preferences").select("draft_ready, analysis_complete").eq("user_id", ws.userId).maybeSingle(),
    supabase.from("organizations").select("recurring_analysis").eq("id", ws.organization.id).single(),
  ]);
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
          recurring={org?.recurring_analysis ?? true}
        />
        <div className="card">
          <h3>Members</h3>
          <p className="muted">Invite people and choose their organization role.</p>
          <Link className="btn light" href="/app/settings/members">
            Manage members
          </Link>
        </div>
        <NotificationsForm
          draftReady={prefs?.draft_ready ?? true}
          analysisComplete={prefs?.analysis_complete ?? true}
          isOwner={ws.organization.role === "owner"}
          emailReady={isEmailConfigured()}
        />
        <PasswordForm title="Security" />
      </div>
    </>
  );
}
