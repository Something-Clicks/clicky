/** Shown while a workspace page loads its data. Says what is happening; no fake progress. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite">
      <h1 className="h1">Loading…</h1>
    </div>
  );
}
