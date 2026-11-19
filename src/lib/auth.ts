import "server-only";

import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "member";

export interface Workspace {
  userId: string;
  email: string;
  fullName: string | null;
  organization: { id: string; name: string; role: Role } | null;
  business: {
    businessName: string;
    website: string | null;
    serviceArea: string | null;
    primaryGoal: string | null;
  } | null;
}

/** The signed-in user, verified with Supabase Auth (not just the cookie). */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    // No session is normal (signed out). Anything else means Auth could not be
    // checked: fail loudly rather than pretending the user is signed out.
    if (error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403) return null;
    log.error("auth.get_user_failed", { name: error.name, status: error.status, code: error.code });
    throw new Error("Authentication service unavailable");
  }
  return data.user ?? null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Everything the signed-in pages need about the current user. Every query runs
 * as the user, so Row Level Security decides what is returned.
 */
export const getWorkspace = cache(async (): Promise<Workspace> => {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: profile }, { data: memberships, error }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("organization_members")
      .select("role, created_at, organizations ( id, name )")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1),
  ]);
  if (error) log.error("workspace.membership_query_failed", { error: error.message });

  const first = memberships?.[0];
  const org = first?.organizations as unknown as { id: string; name: string } | null | undefined;
  let business: Workspace["business"] = null;
  if (org) {
    const { data } = await supabase
      .from("business_profiles")
      .select("business_name, website, service_area, primary_goal")
      .eq("organization_id", org.id)
      .maybeSingle();
    if (data) {
      business = {
        businessName: data.business_name,
        website: data.website,
        serviceArea: data.service_area,
        primaryGoal: data.primary_goal,
      };
    }
  }

  return {
    userId: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    organization: org ? { id: org.id, name: org.name, role: first!.role as Role } : null,
    business,
  };
});

/** For pages that need an organization: sends the user to onboarding until one exists. */
export async function requireOrganization() {
  const workspace = await getWorkspace();
  if (!workspace.organization) redirect("/app/onboarding");
  return workspace as Workspace & { organization: NonNullable<Workspace["organization"]> };
}

/** Platform admins only. Everyone else gets a plain 404, so the area is not advertised. */
export async function requirePlatformAdmin() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_user_is_platform_admin");
  if (error || data !== true) {
    if (error) log.error("admin.check_failed", { error: error.message });
    notFound();
  }
  return user;
}
