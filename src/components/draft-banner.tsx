/** Shown on legal pages until an attorney has reviewed and approved them. */
export function DraftBanner() {
  return (
    <p className="notice yellow" role="note">
      <b>Draft for attorney review.</b> This is not final and has not been approved by a lawyer. Items in [brackets]
      still need a decision.
    </p>
  );
}
