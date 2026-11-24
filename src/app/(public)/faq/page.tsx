import type { Metadata } from "next";

import { PLANS, priceLabel } from "@/config/pricing";

export const metadata: Metadata = { title: "FAQ" };

const FAQS: { q: string; a: string }[] = [
  {
    q: "What do you look at?",
    a: "The public pages of your website: your homepage and up to four key pages such as contact, services and about. We also run Google's mobile speed test on your homepage.",
  },
  {
    q: "What do I get?",
    a: "A short, ranked list of things worth fixing. Each one says what we found, why it matters, and what to do, with the evidence: the page, and whether we observed it, measured it, or couldn't check it.",
  },
  {
    q: "Can you do the work for me?",
    a: "Not yet. For each finding we show exactly what to change and why. You (or your web designer) make the change, mark it done, and check again to see it fixed. We never change anything on your website.",
  },
  {
    q: "Is it really free to start?",
    a: "Yes. You get three free uses: your first result, plus two more after you save it. Each completed website check is one use.",
  },
  {
    q: "How much does it cost after that?",
    a: `The ${PLANS.marketing_plan.name} is ${priceLabel("marketing_plan", "one_time")}. ${PLANS.single_site.name} is ${priceLabel("single_site", "month")} or ${priceLabel("single_site", "year")}. No retainers, cancel any time.`,
  },
  {
    q: "Do you guarantee rankings, calls or sales?",
    a: "No. We explain why each step tends to help, but no one can honestly guarantee rankings, calls or revenue.",
  },
  {
    q: "What does the ZIP code do?",
    a: "It saves where your business is, for local suggestions. Today's checks don't depend on it yet.",
  },
  {
    q: "Who can see my business's information?",
    a: "Only the people on your account. Each business's data is kept separate from every other account.",
  },
];

export default function FaqPage() {
  return (
    <div className="narrow">
      <h1 className="h1">Questions, answered</h1>
      <p className="sub">Short answers about what we do.</p>
      <div className="stack">
        {FAQS.map(({ q, a }) => (
          <details className="card" key={q}>
            <summary>
              <h2 style={{ display: "inline", fontSize: 18 }}>{q}</h2>
            </summary>
            <p className="muted" style={{ margin: "8px 0 0" }}>
              {a}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
