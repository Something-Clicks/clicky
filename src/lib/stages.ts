/**
 * The marketing workflow stages, as the owner sees them. Mirrors the generated
 * `action_cards.stage` / `completion_basis` columns (migration 20261126120000); a database test
 * checks both agree for every status/verification combination.
 *
 *   prepared  - researched and prepared, waiting for the owner
 *   approved  - the owner approved it; not done yet
 *   completed - the team marked it done, or a later check verified it fixed
 *   dismissed - the owner chose not to do it
 *
 * Generating a recommendation or a draft never makes work "completed".
 */
export type Stage = "prepared" | "approved" | "completed" | "dismissed";
export type CompletionBasis = "verified" | "reported" | null;

export function cardStage(card: { status: string; verification: string | null }): Stage {
  if (card.status === "dismissed") return "dismissed";
  if (card.status === "done") return "completed";
  if (card.status === "approved") return card.verification === "fixed" ? "completed" : "approved";
  return "prepared";
}

export function completionBasis(card: { status: string; verification: string | null }): CompletionBasis {
  if ((card.status === "done" || card.status === "approved") && card.verification === "fixed") return "verified";
  if (card.status === "done") return "reported";
  return null;
}

export const STAGE_LABEL: Record<Stage, { label: string; cls: string }> = {
  prepared: { label: "Ready for your review", cls: "pill yellow" },
  approved: { label: "Approved", cls: "pill lavender" },
  completed: { label: "Done", cls: "pill green" },
  dismissed: { label: "Dismissed", cls: "pill" },
};

/** Counts for the home screen: what needs the owner, what is approved but not done, what is done. */
export function stageCounts(cards: { status: string; verification: string | null }[]) {
  const counts: Record<Stage, number> = { prepared: 0, approved: 0, completed: 0, dismissed: 0 };
  for (const c of cards) counts[cardStage(c)]++;
  return counts;
}
