import type { Metadata } from "next";
import Link from "next/link";

import { Clicky } from "@/components/shell";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <div className="hero">
        <div>
          <div className="eyebrow">Why we exist</div>
          <h1>Marketing is the part nobody explains.</h1>
          <p>
            Small business owners are good at their work. Agencies charge retainers for work you can&apos;t see, and
            tools show dashboards that don&apos;t answer the real question: what should I do next?
          </p>
          <div className="row">
            <Link className="btn" href="/diagnostic-audit">
              Start your $39 audit
            </Link>
            <Link className="btn outline" href="/how-it-works">
              See how it works
            </Link>
          </div>
        </div>
        <Clicky size={150} className="mascot" alt="Clicky, the Something Clicks mascot" />
      </div>
      <div className="grid">
        <div className="card">
          <span className="pill">Why</span>
          <h3>So you can understand your marketing</h3>
          <p className="muted">Any owner should be able to see what is working and what needs attention.</p>
        </div>
        <div className="card">
          <span className="pill yellow">How</span>
          <h3>Plain-language Action Cards</h3>
          <p className="muted">
            AI prepares the work. You approve what needs approval. You can always see what was done and why.
          </p>
        </div>
        <div className="card">
          <span className="pill green">What</span>
          <h3>One simple subscription</h3>
          <p className="muted">Connect, analyze, recommend, execute and measure. No jargon and no retainers.</p>
        </div>
      </div>
    </>
  );
}
