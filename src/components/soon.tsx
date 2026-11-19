/**
 * A reference button whose feature is not built yet. It keeps the approved look
 * but cannot be activated, and says why to assistive technology and on hover.
 */
export function SoonButton({
  children,
  variant,
  reason = "Available soon",
}: {
  children: React.ReactNode;
  variant?: "light" | "outline";
  reason?: string;
}) {
  return (
    <button className={variant ? `btn ${variant}` : "btn"} type="button" disabled aria-disabled="true" title={reason}>
      {children}
      <span className="sr-only"> ({reason})</span>
    </button>
  );
}

/** Banner for screens that show sample content until their phase ships. */
export function SampleNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="notice" role="note">
      {children}
    </p>
  );
}
