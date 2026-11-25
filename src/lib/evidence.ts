/**
 * Something Clicks Marketing Agent: the four evidence classes (specification §6.3).
 *
 *   verified  - directly supported by retrieved or supplied information (cites observed/measured
 *               evidence, or the owner supplied it)
 *   inferred  - a reasonable interpretation of available evidence (cites evidence and states its basis)
 *   estimated - a numerical or qualitative estimate with its assumptions stated in the basis
 *   unknown   - not enough information for a reliable determination
 *
 * Evidence *kinds* describe raw evidence items (observed / measured / estimated / missing).
 * Evidence *classes* describe claims built on them: findings, Action Cards and business facts.
 * The database enforces the same rules (migration 20261127120000); tests keep both in agreement.
 */
export const EVIDENCE_CLASSES = ["verified", "inferred", "estimated", "unknown"] as const;
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number];

export const EVIDENCE_KINDS = ["observed", "measured", "estimated", "missing"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const isEvidenceClass = (v: unknown): v is EvidenceClass => typeof v === "string" && (EVIDENCE_CLASSES as readonly string[]).includes(v);

/**
 * The class a fixed-check finding earns from the kinds of evidence it cites.
 * Strongest wins: any observed or measured item makes it verified.
 */
export function classFromKinds(kinds: readonly string[]): EvidenceClass {
  if (kinds.some((k) => k === "observed" || k === "measured")) return "verified";
  if (kinds.includes("estimated")) return "estimated";
  return "unknown";
}

export interface ClassifiedClaim {
  evidence_class: EvidenceClass;
  /** Kinds of the evidence items the claim cites. */
  cited_kinds: readonly string[];
  /** How an inferred or estimated claim was derived, and what it assumes. */
  basis: string | null;
  /** True when the business owner supplied the information directly. */
  owner_supplied?: boolean;
}

/** Why a claim breaks the evidence rules, or null when it is valid. Mirrors the database checks. */
export function claimProblem(c: ClassifiedClaim): string | null {
  const hasBasis = Boolean(c.basis?.trim());
  switch (c.evidence_class) {
    case "verified":
      return c.owner_supplied || c.cited_kinds.some((k) => k === "observed" || k === "measured") ? null : "verified_without_direct_evidence";
    case "inferred":
      if (!c.cited_kinds.length) return "inferred_without_evidence";
      return hasBasis ? null : "inferred_without_basis";
    case "estimated":
      return hasBasis ? null : "estimated_without_basis";
    case "unknown":
      return null;
  }
}

/** Plain words for internal screens and reports. Customers see evidence kinds, not these labels. */
export const EVIDENCE_CLASS_LABEL: Record<EvidenceClass, string> = {
  verified: "Verified",
  inferred: "Inferred",
  estimated: "Estimated",
  unknown: "Unknown",
};
