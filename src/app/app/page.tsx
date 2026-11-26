import type { Metadata } from "next";
import Link from "next/link";

import { ActionCardItem } from "@/components/intelligence";
import { AutoRefresh, RunAnalysisButton } from "@/components/run-analysis";
import { TrackEvent } from "@/components/track-event";
import { Clicky } from "@/components/shell";
import { requireOrganization } from "@/lib/auth";
import {
  getCards,
  getEntitlements,
  getFreeUses,
  getLastCompleteAnalysis,
  getLatestAnalysis,
  getPendingApprovalCount,
  isStale,
  openCards,
  relativeDay,
} from "@/lib/queries";
import { FEATURES } from "@/config/features";
import { createClient } from "@/lib/supabase/server";
import { planName } from "@/config/pricing";
import { stageCounts } from "@/lib/stages";

import { Greeting } from "./greeting";

export const metadata: Metadata = { title: "Home" };
export const maxDuration = 120;

export default async function HomePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const ws = await requireOrganization();
  const { welcome } = await searchParams;
  const [latest, lastComplete, cards, approvalsWaiting, ent, free] = await Promise.all([
    getLatestAnalysis(ws.organization.id),
    getLastCompleteAnalysis(ws.organization.id),
    getCards(ws.organization.id),
    getPendingApprovalCount(ws.organization.id),
    getEntitlements(ws.organization.id),
    getFreeUses(ws.organization.id),
  ]);
  // Pointers to the next steps of the journey, only where those screens exist (switches are off in Production).
  const supabase = await createClient();
  const [{ count: detailsToCheck }, { data: planRow }, { data: campaignRows }] = await Promise.all([
    FEATURES.businessProfile
      ? supabase.from("business_facts").select("id", { count: "exact", head: true }).eq("organization_id", ws.organization.id).eq("status", "proposed").not("value", "is", null)
      : Promise.resolve({ count: 0 }),
    FEATURES.strategy
      ? supabase.from("marketing_plans").select("status").eq("organization_id", ws.organization.id).in("status", ["proposed", "approved"]).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    FEATURES.campaigns
      ? supabase.from("marketing_campaigns").select("status").eq("organization_id", ws.organization.id).in("status", ["proposed", "approved"]).limit(20)
      : Promise.resolve({ data: [] as { status: string }[] }),
  ]);
  const campaignsToReview = (campaignRows ?? []).filter((c) => c.status === "proposed").length;
  const campaignsActive = (campaignRows ?? []).filter((c) => c.status === "approved").length;
  const open = openCards(cards);
  const stages = stageCounts(open);
  const running = latest?.status === "running";
  // The newest check ended without results: say so on Home, in plain words (a failed check does not use a free use).
  const failedCheck = latest?.status === "failed" && (!lastComplete || new Date(latest.started_at) > new Date(lastComplete.completed_at ?? 0)) ? latest : null;
  const next = open.find((c) => c.status === "new") ?? open[0];
  const more = open.filter((c) => c.id !== next?.id).slice(0, 2);
  const canRun = ent.analyses || free.remaining > 0;
  const site = ws.business?.website ? new URL(ws.business.website).hostname.replace(/^www\./, "") : null;

  return (
    <div className="stack">
      <AutoRefresh active={running} />
      {welcome ? <TrackEvent name="account_created" /> : null}
      {welcome ? (
        <p className="notice green" role="status">
          Your results are saved.{" "}
          {free.remaining > 0 ? `You have ${free.remaining} free ${free.remaining === 1 ? "use" : "uses"} left.` : null}
        </p>
      ) : null}
      <div>
        <h1 className="h1">
          <Greeting />
        </h1>
        <div className="row">
          {site ? <span className="pill">{site}</span> : null}
          {ent.plan ? (
            <span className="pill green">{planName(ent.plan)}</span>
          ) : (
            <Link href="/app/upgrade" className={free.remaining > 0 ? "pill lavender" : "pill coral"} style={{ textDecoration: "none" }}>
              {free.remaining > 0 ? `${free.remaining} of ${free.limit} free uses left` : "Free uses used up"}
            </Link>
          )}
          {FEATURES.businessProfile && ws.organization.role === "owner" ? (
            <Link href="/app/business" className={(detailsToCheck ?? 0) > 0 ? "pill yellow" : "pill"} style={{ textDecoration: "none" }}>
              {(detailsToCheck ?? 0) > 0 ? `${detailsToCheck} ${detailsToCheck === 1 ? "detail" : "details"} about your business to check` : "Business details"}
            </Link>
          ) : null}
          {FEATURES.strategy && lastComplete && (open.length > 0 || planRow) ? (
            <Link href="/app/plan" className={planRow?.status === "proposed" ? "pill yellow" : "pill"} style={{ textDecoration: "none" }}>
              {planRow?.status === "proposed" ? "Your plan is ready to review" : planRow ? "Your plan" : "Get your plan"}
            </Link>
          ) : null}
          {FEATURES.campaigns && lastComplete ? (
            <>
              <Link href="/app/campaigns" className={campaignsToReview > 0 ? "pill yellow" : "pill"} style={{ textDecoration: "none" }}>
                {campaignsToReview > 0 ? `${campaignsToReview} ${campaignsToReview === 1 ? "campaign" : "campaigns"} to review` : campaignsActive > 0 ? `${campaignsActive} in progress` : "Campaigns"}
              </Link>
              <Link href="/app/research" className="pill" style={{ textDecoration: "none" }}>Compare</Link>
            </>
          ) : null}
          {FEATURES.drafts && approvalsWaiting > 0 ? (
            <Link href="/app/approvals" className="pill yellow" style={{ textDecoration: "none" }}>
              {approvalsWaiting} {approvalsWaiting === 1 ? "draft" : "drafts"} to review
            </Link>
          ) : null}
        </div>
      </div>

      {failedCheck && !running ? (
        <p className="notice error" role="alert">
          The last check didn&apos;t finish. {failedCheck.failure_reason ?? "Please try again."} It didn&apos;t use one of your free uses.
        </p>
      ) : null}

      {running ? (
        <div className="card empty working" role="status">
          <Clicky size={140} alt="" />
          <h2>Checking {site ?? "your website"}…</h2>
          <p className="muted">This usually takes about a minute.</p>
        </div>
      ) : next ? (
        <>
          <h2 style={{ margin: "8px 0 0" }}>Your next move</h2>
          {stages.prepared || stages.approved ? (
            <p className="small muted" style={{ margin: 0 }}>
              {[
                stages.prepared ? `${stages.prepared} ready for your review` : null,
                stages.approved ? `${stages.approved} approved, not done yet` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          <ActionCardItem card={next} cta="Let's do it" primary />
          {more.length ? (
            <>
              {more.map((c) => (
                <ActionCardItem key={c.id} card={c} cta="Open" />
              ))}
              {open.length > 3 ? (
                <Link className="btn ghost" href="/app/actions">
                  See all {open.length}
                </Link>
              ) : null}
            </>
          ) : null}
        </>
      ) : lastComplete ? (
        <div className="card empty">
          <Clicky size={72} alt="" />
          <h2>You&apos;re all caught up</h2>
          <p className="muted">Nothing open right now. Check again after you change your website.</p>
          <RunAnalysisButton entitled={canRun} />
        </div>
      ) : !site ? (
        <div className="card empty">
          <Clicky size={72} alt="" />
          <h2>Add your website</h2>
          <Link className="btn" href="/app/onboarding">
            Add your website
          </Link>
        </div>
      ) : (
        <div className="card empty">
          <Clicky size={140} alt="" />
          <h2>Let&apos;s check {site}</h2>
          <p className="muted">About a minute. Uses one free use.</p>
          <RunAnalysisButton entitled={canRun} />
        </div>
      )}

      {lastComplete && !running ? (
        <div className="card quiet between">
          <div>
            <b>Last checked {relativeDay(lastComplete.completed_at).toLowerCase()}</b>
            {isStale(lastComplete.completed_at) ? <div className="small muted">More than 30 days ago.</div> : null}
          </div>
          <RunAnalysisButton label="Check again" entitled={canRun} />
        </div>
      ) : null}
    </div>
  );
}
