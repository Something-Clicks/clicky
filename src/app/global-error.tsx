"use client";

import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-US">
      <body>
        <main className="main" style={{ maxWidth: 640, margin: "10vh auto" }}>
          <div className="card" role="alert">
            <h1 className="h1">Something went wrong on our side.</h1>
            <p className="sub">
              Try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ""}
            </p>
            <button className="btn" type="button" onClick={reset}>
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
