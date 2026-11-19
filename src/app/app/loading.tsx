/** Shown while a workspace page loads its data. Says what is happening; no fake progress. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <div className="eyebrow">Your workspace</div>
      <h1 className="h1">Loading your workspace…</h1>
      <p className="sub">Getting your latest business details and activity.</p>
    </div>
  );
}
