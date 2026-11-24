import type { Metadata } from "next";

import { SoonButton } from "@/components/soon";
import { requireOrganization } from "@/lib/auth";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const { organization, userId } = await requireOrganization();
  const supabase = await createClient();
  const { data: members, error } = await supabase
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", organization.id)
    .order("created_at");
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  if (error) log.error("members.query_failed", { organizationId: organization.id, error: error.message });
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return (
    <>
      <h1 className="h1">Members</h1>
      <p className="sub">Invite people and choose their organization role.</p>
      <div className="card">
        <div className="row between">
          <h3>People with access</h3>
          <SoonButton variant="light" reason="Invitations open soon">
            Invite someone
          </SoonButton>
        </div>
        {error ? (
          <p className="notice error" role="alert">
            We couldn&apos;t load members right now. Refresh the page to try again.
          </p>
        ) : (
          <div className="list">
            {(members ?? []).map((m) => (
              <div className="item" key={m.user_id}>
                <b>
                  {names.get(m.user_id) ?? "Unnamed member"}
                  {m.user_id === userId ? <span className="muted"> (you)</span> : null}
                </b>
                <span className={m.role === "owner" ? "pill" : "pill green"}>
                  {m.role === "owner" ? "Owner" : "Member"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
