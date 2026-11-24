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
import { planName } from "@/config/pricing";

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
  const open = openCards(cards);
  const running = latest?.status === "running";
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
          {FEATURES.drafts && approvalsWaiting > 0 ? (
            <Link href="/app/approvals" className="pill yellow" style={{ textDecoration: "none" }}>
              {approvalsWaiting} {approvalsWaiting === 1 ? "draft" : "drafts"} to review
            </Link>
          ) : null}
        </div>
      </div>

      {running ? (
        <div className="card empty working" role="status">
          <Clicky size={140} alt="" />
          <h2>Checking {site ?? "your website"}…</h2>
          <p className="muted">This usually takes about a minute.</p>
        </div>
      ) : next ? (
        <>
          <h2 style={{ margin: "8px 0 0" }}>Your next move</h2>
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
