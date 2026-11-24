import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SaveThis, Thumbs, WorkingSteps } from "@/components/preview-parts";
import { AutoRefresh } from "@/components/run-analysis";
import { getPreview, type Preview, type PreviewCard, type PreviewEvidence } from "@/lib/server/preview";
import { isPreviewEnabled } from "@/lib/server/site";

export const metadata: Metadata = { title: "Your results", robots: { index: false } };
export const dynamic = "force-dynamic";

const KIND: Record<string, { label: string; cls: string }> = {
  observed: { label: "Observed", cls: "pill" },
  measured: { label: "Measured", cls: "pill green" },
  missing: { label: "Missing", cls: "pill yellow" },
  estimated: { label: "Estimate", cls: "pill lavender" },
};
const IMPACT: Record<string, { label: string; cls: string }> = {
  high: { label: "High impact", cls: "pill coral" },
  medium: { label: "Medium impact", cls: "pill yellow" },
  low: { label: "Low impact", cls: "pill green" },
};

function where(url: string | null) {
  if (!url) return null;
  try {
    const p = new URL(url).pathname;
    return p === "/" ? "your homepage" : p;
  } catch {
    return null;
  }
}

function Card({ card, evidence }: { card: PreviewCard; evidence: PreviewEvidence[] }) {
  const ev = card.evidence_keys.map((k) => evidence.find((e) => e.key === k)).filter(Boolean) as PreviewEvidence[];
  const impact = IMPACT[card.impact_priority] ?? IMPACT.medium!;
  return (
    <article className={`card action ${card.impact_priority}`} data-clarity-mask="true">
      <div className="row">
        <span className={impact.cls}>{impact.label}</span>
        {ev[0] ? <span className={KIND[ev[0].kind]?.cls ?? "pill"}>{KIND[ev[0].kind]?.label ?? ev[0].kind}</span> : null}
      </div>
      <h3>{card.title}</h3>
      <p>{card.explanation}</p>
      <details>
        <summary>What to do and why</summary>
        <p>
          <b>Why it matters.</b> {card.why_it_matters}
        </p>
        <p>
          <b>What to do.</b> {card.recommended_action}
        </p>
        <p className="muted small">{card.expected_benefit}</p>
        {ev.map((e) => (
          <div className="evidence" key={e.key}>
            <b>{KIND[e.kind]?.label ?? e.kind}</b>
            {where(e.url) ? <> · {where(e.url)}</> : e.source === "pagespeed" ? <> · Google PageSpeed</> : null}
            <div>{e.observation}</div>
            {e.excerpt ? <div className="muted">“{e.excerpt}”</div> : null}
          </div>
        ))}
      </details>
    </article>
  );
}

function Working({ p }: { p: Preview }) {
  return (
    <div className="working narrow" role="status" aria-live="polite">
      <AutoRefresh active everyMs={3000} />
      <Image src="/brand/clicky-3d.png" alt="" width={720} height={502} priority />
      <h1 className="h1">Checking {p.domain}</h1>
      <p className="sub">This usually takes under a minute.</p>
      <WorkingSteps />
    </div>
  );
}

function Results({ p }: { p: Preview }) {
  const cards = p.cards ?? [];
  const evidence = p.evidence ?? [];
  const pages = p.coverage?.website?.pages_reviewed ?? 1;
  const speed = p.coverage?.pagespeed;
  return (
    <div className="stack narrow">
      <div>
        <div className="eyebrow">{p.domain}</div>
        <h1 className="h1">{cards.length === 0 ? "Nice work. Nothing big to fix." : `${cards.length} ${cards.length === 1 ? "thing" : "things"} worth fixing`}</h1>
        <p className="sub">
          We reviewed {pages} {pages === 1 ? "page" : "pages"}
          {speed?.status === "measured" ? ` and measured mobile speed (${speed.score}/100)` : ""}.
        </p>
        {speed?.status === "missing" ? (
          <p className="notice yellow small">Google&apos;s speed test was busy, so mobile speed is missing this time.</p>
        ) : null}
      </div>
      {cards.map((c) => (
        <Card key={c.check_key} card={c} evidence={evidence} />
      ))}
      <Thumbs />
      <div className="sticky-cta">
        {p.saved ? (
          <div className="card" role="status">
            <h2>Check your email</h2>
            <p className="muted">Open the link on any device to save your results. Didn&apos;t get it? Send it again below.</p>
            <SaveThis domain={p.domain} />
          </div>
        ) : (
          <SaveThis domain={p.domain} />
        )}
      </div>
    </div>
  );
}

export default async function StartPage() {
  if (!isPreviewEnabled()) redirect("/");
  const p = await getPreview();
  if (!p) redirect("/");
  if (p.claimed) redirect("/app");
  if (p.status === "running") return <Working p={p} />;
  if (p.status === "failed") {
    return (
      <div className="empty narrow">
        <Image src="/brand/clicky-flat-192.png" alt="" width={96} height={96} />
        <h1 className="h1">We couldn&apos;t finish</h1>
        <p className="sub">{p.failure_reason}</p>
        <Link className="btn" href="/">
          Try again
        </Link>
      </div>
    );
  }
  return <Results p={p} />;
}
