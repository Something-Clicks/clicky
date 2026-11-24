import type { Metadata } from "next";
import Link from "next/link";

import { ActionCardItem } from "@/components/intelligence";
import { RunAnalysisButton } from "@/components/run-analysis";
import { Clicky } from "@/components/shell";
import { requireOrganization } from "@/lib/auth";
import { completedCards, getEntitlements, getCards, openCards } from "@/lib/queries";

export const metadata: Metadata = { title: "Action cards" };
export const maxDuration = 120;

const FILTERS = [
  { key: "open", label: "To do" },
  { key: "done", label: "Done" },
  { key: "dismissed", label: "Dismissed" },
] as const;

export default async function ActionsPage({ searchParams }: { searchParams: Promise<{ show?: string; impact?: string }> }) {
  const ws = await requireOrganization();
  const { show = "open", impact } = await searchParams;
  const [all, ent] = await Promise.all([getCards(ws.organization.id), getEntitlements(ws.organization.id)]);
  let cards = show === "done" ? completedCards(all) : show === "dismissed" ? all.filter((c) => c.status === "dismissed") : openCards(all);
  if (impact && ["high", "medium", "low"].includes(impact)) cards = cards.filter((c) => c.impact_priority === impact);

  const href = (s: string, i?: string) => `/app/actions?show=${s}${i ? `&impact=${i}` : ""}`;

  return (
    <>
      <h1 className="h1">To do</h1>
      <p className="sub">Most important first. Each one shows the evidence.</p>
      <nav className="steps" aria-label="Filter actions" style={{ marginTop: 0 }}>
        {FILTERS.map((f) => (
          <Link key={f.key} href={href(f.key, impact)} className={show === f.key ? "step done" : "step"} aria-current={show === f.key ? "page" : undefined} style={{ textDecoration: "none" }}>
            {f.label}
          </Link>
        ))}
        {(["high", "medium", "low"] as const).map((i) => (
          <Link key={i} href={impact === i ? href(show) : href(show, i)} className={impact === i ? "step done" : "step"} aria-current={impact === i ? "true" : undefined} style={{ textDecoration: "none" }}>
            {i[0]!.toUpperCase() + i.slice(1)} impact
          </Link>
        ))}
      </nav>
      {cards.length ? (
        <div className="list">
          {cards.map((card) => (
            <ActionCardItem key={card.id} card={card} />
          ))}
        </div>
      ) : (
        <div className="card empty">
          <Clicky size={72} alt="" />
          {all.length === 0 ? (
            <>
              <h3>No Action Cards yet.</h3>
              <p className="muted">Run an analysis of your website and your first recommendations will appear here.</p>
              <RunAnalysisButton label="Run your first analysis" entitled={ent.analyses} />
            </>
          ) : (
            <>
              <h3>Nothing here.</h3>
              <p className="muted">No cards match this filter.</p>
              <Link className="btn light" href="/app/actions">
                Show what&apos;s to do
              </Link>
            </>
          )}
        </div>
      )}
    </>
  );
}
