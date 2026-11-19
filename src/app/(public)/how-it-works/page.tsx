import type { Metadata } from "next";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return (
    <>
      <div className="eyebrow">A simpler way forward</div>
      <h1 className="h1">From guesswork to a clear next step.</h1>
      <p className="sub">One simple process. You can see what is happening at every step.</p>
      <div className="steps">
        <span className="step done">1. Connect</span>
        <span className="step done">2. Analyze</span>
        <span className="step">3. Recommend</span>
        <span className="step">4. Execute</span>
        <span className="step">5. Measure</span>
      </div>
      <div className="grid two">
        <div className="card">
          <h3>Connect your business</h3>
          <p className="muted">Start with your website. Add supported Google sources when you choose.</p>
        </div>
        <div className="card">
          <h3>Understand the picture</h3>
          <p className="muted">See findings with evidence, freshness, and clear explanations.</p>
        </div>
        <div className="card">
          <h3>Choose what matters</h3>
          <p className="muted">Action Cards prioritize useful improvements by impact and confidence.</p>
        </div>
        <div className="card">
          <h3>Approve and make progress</h3>
          <p className="muted">Review drafts, approve work, and see the result in your activity.</p>
        </div>
      </div>
    </>
  );
}
