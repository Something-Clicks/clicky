import Link from "next/link";

import { Clicky } from "@/components/shell";

export default function AppNotFound() {
  return (
    <div className="card empty">
      <Clicky size={72} alt="" />
      <h1 className="h1">We couldn&apos;t find that.</h1>
      <p className="sub" style={{ margin: "0 auto 20px" }}>
        It may have been removed, or the link is mistyped.
      </p>
      <Link className="btn" href="/app">
        Back to your dashboard
      </Link>
    </div>
  );
}
