import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CampaignForm } from "@/components/agent-forms";
import { FEATURES } from "@/config/features";
import { requireOrganization } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS: Record<string, [string, string]> = { proposed: ["Waiting for your review", "yellow"], approved: ["In progress", "green"], completed: ["Finished", "green"] };

/** Campaigns: short, guided task lists the Marketing Agent prepares from what it found. Nothing is published or sent. */
export default async function CampaignsPage() {
  if (!FEATURES.campaigns) notFound();
  const ws = await requireOrganization();
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("marketing_campaigns")
    .select("id, title, summary, status")
    .eq("organization_id", ws.organization.id)
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(20);
  const list = rows ?? [];
  const { data: taskRows } = list.length ? await supabase.from("campaign_tasks").select("campaign_id, status").in("campaign_id", list.map((c) => c.id)) : { data: [] as { campaign_id: string; status: string }[] };
  return (
    <div className="stack">
      <div>
        <h1 className="h1">Campaigns</h1>
        <p className="sub">Short task lists to carry out, each with the reason behind it. You approve every one, and you do the work.</p>
      </div>
      <section className="card stack"><CampaignForm again={list.length > 0} />
        <p className="small muted">Built with fixed playbooks from your website check, the details you confirmed, and the sites you compared. A playbook only appears when we found something that calls for it.</p></section>
      {list.map((c) => {
        const t = (taskRows ?? []).filter((x) => x.campaign_id === c.id);
        const done = t.filter((x) => x.status === "done" || x.status === "skipped").length;
        const [label, tone] = STATUS[c.status] ?? [c.status, ""];
        return (
          <section key={c.id} className="card stack">
            <div className="row between"><h2 style={{ margin: 0 }}><Link className="link" href={`/app/campaigns/${c.id}`}>{c.title}</Link></h2><span className={`pill ${tone}`}>{label}</span></div>
            <p>{c.summary}</p>
            <p className="small muted">{done} of {t.length} tasks done</p>
          </section>
        );
      })}
      {!list.length ? (
        <p className="muted">Nothing here yet. We build campaigns from your <Link className="link" href="/app">website check</Link>, and from what you <Link className="link" href="/app/research">compare it with</Link>. Press the button above once you have a check.</p>
      ) : null}
      {FEATURES.businessProfile ? <p className="small muted">Tip: confirm where you work and what you offer in <Link className="link" href="/app/business">Business details</Link>. Some campaigns, like your Google profile, need them.</p> : null}
    </div>
  );
}
