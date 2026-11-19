import Link from "next/link";

import { Clicky } from "@/components/shell";

export default function HomePage() {
  return (
    <>
      <div className="hero">
        <div>
          <div className="eyebrow">Marketing, made clearer</div>
          <h1>Make the complicated click.</h1>
          <p>
            Know what is working, what needs attention, and what to do next. AI helps prepare the work. You stay in
            control.
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
          <span className="pill">01 · Understand</span>
          <h3>See what needs attention</h3>
          <p className="muted">Your website and connected marketing data, explained in plain language.</p>
        </div>
        <div className="card">
          <span className="pill yellow">02 · Decide</span>
          <h3>Know your next move</h3>
          <p className="muted">Prioritized Action Cards show what matters and why.</p>
        </div>
        <div className="card">
          <span className="pill green">03 · Do</span>
          <h3>Get the work moving</h3>
          <p className="muted">AI prepares useful work. You approve what happens next.</p>
        </div>
      </div>
    </>
  );
}
