import Image from "next/image";
import Link from "next/link";

import { ConsentSettingsButton } from "./consent";

/** Public pages: logo, two links, content, footer. Fits a 390px phone without a menu. */
export function SiteChrome({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  return (
    <div className="site">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-head">
        <Link className="logo" href="/">
          <Image src="/brand/clicky-flat-96.png" alt="" width={32} height={32} priority />
          Something Clicks
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link href="/pricing">Pricing</Link>
          {signedIn ? <Link href="/app">Your account</Link> : <Link href="/login">Log in</Link>}
        </nav>
      </header>
      <main className="site-main" id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-foot">
        <nav aria-label="Footer">
          <Link href="/how-it-works">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/about">About</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <ConsentSettingsButton enabled={Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || process.env.CLARITY_ID?.trim())} />
        </nav>
      </footer>
    </div>
  );
}
