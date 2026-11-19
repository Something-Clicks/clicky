import type { Metadata } from "next";

import { formatPrice, PLANS } from "@/config/pricing";

export const metadata: Metadata = { title: "FAQ" };

const FAQS: { q: string; a: string }[] = [
  {
    q: "What is Something Clicks?",
    a: "A subscription that looks at your website and the marketing data you choose to connect, explains what it finds in plain language, and turns it into a short list of next steps called Action Cards.",
  },
  {
    q: "Do I need to know anything about marketing?",
    a: "No. Every recommendation says what needs attention, why it matters, and what to do next, without jargon.",
  },
  {
    q: "What does the AI do?",
    a: "It reviews the evidence and prepares drafts, such as clearer page text, page titles, Google Business Profile posts and review replies. You review each draft before it is used. Nothing is published for you unless you connect a supported service and approve it.",
  },
  {
    q: "What information do you use?",
    a: "Your website's public pages. Google Search Console, PageSpeed Insights and Google Business Profile are used only if you choose to connect them, and you can disconnect at any time.",
  },
  {
    q: "Where do recommendations come from?",
    a: "Every Action Card shows the evidence behind it, such as the page and what we observed. We label what was observed, what is estimated, and what is a suggestion.",
  },
  {
    q: "Do you guarantee rankings, calls or sales?",
    a: "No. We explain the expected benefit of each step, but no one can honestly guarantee rankings, calls or revenue.",
  },
  {
    q: "How much does it cost?",
    a: `The Diagnostic Audit is ${formatPrice(PLANS.diagnostic_audit)} one time. Monthly plans are ${formatPrice(PLANS.starter_ai)}, ${formatPrice(PLANS.growth_ai)} and ${formatPrice(PLANS.scale_automation)} a month. There are no retainers.`,
  },
  {
    q: "Who can see my business's information?",
    a: "Only the people on your account. Each business's data is kept separate from every other account.",
  },
];

export default function FaqPage() {
  return (
    <>
      <div className="eyebrow">Questions, answered</div>
      <h1 className="h1">Plain answers about how it works.</h1>
      <p className="sub">About the product, AI, your data, billing and approvals.</p>
      <div className="list">
        {FAQS.map(({ q, a }) => (
          <details className="card" key={q}>
            <summary>
              <h3 style={{ display: "inline" }}>{q}</h3>
            </summary>
            <p className="muted" style={{ marginBottom: 0 }}>
              {a}
            </p>
          </details>
        ))}
      </div>
    </>
  );
}
