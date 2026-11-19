"use client";

import { useEffect } from "react";

/** Any unexpected error in a page: say what happened and offer the next step. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server already logged the details; the digest links the two.
    console.error(JSON.stringify({ level: "error", event: "ui.error_boundary", digest: error.digest }));
  }, [error]);

  return (
    <main className="main" id="main" style={{ maxWidth: 640, margin: "10vh auto" }}>
      <div className="card empty" role="alert">
        <h1 className="h1">Something went wrong on our side.</h1>
        <p className="sub" style={{ margin: "0 auto 20px" }}>
          Your information is safe. Try again, and if it keeps happening, come back in a few minutes.
          {error.digest ? <span className="small"> Reference: {error.digest}</span> : null}
        </p>
        <button className="btn" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
