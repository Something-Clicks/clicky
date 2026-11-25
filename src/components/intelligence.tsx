import Link from "next/link";

import { firstEvidence, impactLabel, type CardRow } from "@/lib/queries";
import { cardStage, STAGE_LABEL } from "@/lib/stages";

export const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  new: { label: "New", cls: "pill" },
  approved: { label: "Approved", cls: "pill green" },
  in_progress: { label: "In progress", cls: "pill yellow" },
  done: { label: "Done", cls: "pill green" },
  failed: { label: "Failed", cls: "pill coral" },
  dismissed: { label: "Dismissed", cls: "pill" },
};

export const KIND_LABEL: Record<string, string> = {
  observed: "Observed",
  measured: "Measured",
  estimated: "Estimate",
  missing: "Missing data",
};

export function VerificationPill({ verification }: { verification: string | null }) {
  if (verification === "fixed") return <span className="pill green">Verified fixed</span>;
  if (verification === "still_found") return <span className="pill coral">Still found</span>;
  return null;
}

export function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, cls: "pill" };
  return <span className={s.cls}>{s.label}</span>;
}

/** Where the work is: ready for your review, approved, done, or dismissed. */
export function StagePill({ card }: { card: { status: string; verification: string | null } }) {
  const s = STAGE_LABEL[cardStage(card)];
  return <span className={s.cls}>{s.label}</span>;
}

/** Where a card came from. Every card today comes from a fixed website check, never from a model. */
export function OriginPill({ origin }: { origin: string | null | undefined }) {
  return origin === "model" ? <span className="pill">From a closer look at your website</span> : <span className="pill">From a website check</span>;
}

/** One Action Card in the reference's .card.action style. */
export function ActionCardItem({ card, cta = "See why it matters", primary = false }: { card: CardRow; cta?: string; primary?: boolean }) {
  const ev = firstEvidence(card);
  return (
    <div className="card action">
      <div className="row between">
        <div className="tag">
          {impactLabel(card.impact_priority)} · {card.confidence.toUpperCase()} CONFIDENCE
        </div>
        <div className="row" style={{ gap: 6 }}>
          {cardStage(card) !== "prepared" ? <StagePill card={card} /> : null}
          <VerificationPill verification={card.verification} />
        </div>
      </div>
      <h3>{card.title}</h3>
      <p>{card.explanation}</p>
      {ev ? (
        <div className="evidence">
          Evidence ({KIND_LABEL[ev.kind]?.toLowerCase() ?? ev.kind}): {ev.observation}
          {ev.url ? <> · {new URL(ev.url).pathname}</> : null}
        </div>
      ) : null}
      <Link className={primary ? "btn" : "btn light"} href={`/app/actions/${card.id}`}>
        {cta}
      </Link>
    </div>
  );
}

export function EvidenceLine({ e }: { e: { kind: string; source: string; url: string | null; observation: string; excerpt: string | null } }) {
  return (
    <div className="evidence">
      <b>{KIND_LABEL[e.kind] ?? e.kind}</b> · {e.source === "pagespeed" ? "PageSpeed Insights" : "Your website"}
      {e.url && /^https?:\/\//i.test(e.url) ? (
        <>
          {" "}
          ·{" "}
          <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="link">
            {new URL(e.url).pathname}
          </a>
        </>
      ) : null}
      <div>{e.observation}</div>
      {e.excerpt ? <div className="muted">“{e.excerpt}”</div> : null}
    </div>
  );
}
