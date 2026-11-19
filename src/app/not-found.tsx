import Link from "next/link";

import { Clicky } from "@/components/shell";

export default function NotFound() {
  return (
    <main className="main" id="main" style={{ maxWidth: 640, margin: "10vh auto" }}>
      <div className="card empty">
        <Clicky size={72} alt="" />
        <h1 className="h1">We couldn&apos;t find that page.</h1>
        <p className="sub" style={{ margin: "0 auto 20px" }}>
          The link may be old or mistyped.
        </p>
        <Link className="btn" href="/">
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
