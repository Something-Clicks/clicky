import type { Metadata } from "next";
import Link from "next/link";

import { SampleNotice } from "@/components/soon";
import { SAMPLE_ACTIONS } from "@/content/samples";
import { requireOrganization } from "@/lib/auth";

export const metadata: Metadata = { title: "Action cards" };

export default async function ActionsPage() {
  await requireOrganization();
  return (
    <>
      <div className="eyebrow">Your priorities</div>
      <h1 className="h1">A few things worth your attention.</h1>
      <p className="sub">Each recommendation explains the evidence, the reason, and the next step.</p>
      <SampleNotice>These are samples. Your own Action Cards appear here after your first website analysis.</SampleNotice>
      <div className="list">
        {SAMPLE_ACTIONS.map((card) => (
          <div className="card action" key={card.title}>
            <div className="tag">{card.impact} · SAMPLE</div>
            <h3>{card.title}</h3>
            <p>{card.summary}</p>
            <div className="evidence">{card.evidence}</div>
            <Link className="btn light" href={`/app/actions/${card.id}`}>
              {card.cta}
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}
