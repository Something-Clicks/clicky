import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div className="narrow stack">
      <Image className="mascot" src="/brand/clicky-3d.png" alt="Clicky, the Something Clicks character" width={720} height={502} style={{ width: 160 }} />
      <h1 className="h1">Marketing help that gets work done</h1>
      <p>
        Small business owners are great at their work. Marketing is the part nobody explains. Something Clicks looks at
        your website and tells you what&apos;s worth fixing, in plain words, with the evidence and what to do.
      </p>
      <p>You stay in charge. Every finding shows its evidence, and we never change anything on your website.</p>
      <p className="muted small">Something Clicks LLC · Salt Lake City, Utah</p>
      <div>
        <Link className="btn" href="/">
          Check your website
        </Link>
      </div>
    </div>
  );
}
