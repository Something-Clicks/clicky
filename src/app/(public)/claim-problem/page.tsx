import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "Link problem", robots: { index: false } };

const REASONS: Record<string, { title: string; body: string }> = {
  expired: { title: "That link has expired", body: "Links work for 24 hours. Check your website again to get a new one." },
  wrong_email: {
    title: "That link is for a different email",
    body: "Sign out, then open the link again and sign in with the email address you entered when you saved your results.",
  },
  unverified: { title: "Confirm your email first", body: "Open the most recent link we sent you, then try again." },
  other_site: {
    title: "Your account already has a website",
    body: "This account is set up for a different website. Sign in with another email to save these results.",
  },
  invalid: { title: "That link has already been used", body: "If you saved your results already, they're in your account." },
};

export default async function ClaimProblem({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const r = REASONS[reason ?? ""] ?? REASONS.invalid!;
  return (
    <div className="empty narrow">
      <Image src="/brand/clicky-flat-192.png" alt="" width={96} height={96} />
      <h1 className="h1">{r.title}</h1>
      <p className="sub">{r.body}</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Link className="btn" href="/app">
          Go to your account
        </Link>
        <Link className="btn light" href="/">
          Check a website
        </Link>
      </div>
    </div>
  );
}
