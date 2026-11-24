import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works" };

export default function HowItWorksPage() {
  return (
    <div className="narrow stack">
      <h1 className="h1">How it works</h1>
      <ol className="steps">
        <li className="step">
          <div>
            <b>Enter your website.</b>
            <div className="muted">We read your homepage and key pages and test mobile speed.</div>
          </div>
        </li>
        <li className="step">
          <div>
            <b>See what&apos;s worth fixing.</b>
            <div className="muted">A short, ranked list, each with the evidence behind it.</div>
          </div>
        </li>
        <li className="step">
          <div>
            <b>Get drafts.</b>
            <div className="muted">Page titles, homepage copy, Google Business Profile posts and blog posts. You approve each one.</div>
          </div>
        </li>
        <li className="step">
          <div>
            <b>See what improved.</b>
            <div className="muted">Each new check shows what&apos;s fixed and what&apos;s still there.</div>
          </div>
        </li>
      </ol>
      <div>
        <Link className="btn" href="/">
          Check your website
        </Link>
      </div>
    </div>
  );
}
