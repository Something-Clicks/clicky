/**
 * The evaluation dataset's shape. Every case is a FICTIONAL business (no customer data, no real names) with hand-written
 * website pages and hand-written ground truth. The ground truth is what a person or an automatic check compares a model's
 * output against. The dataset is frozen (FREEZE.json): changing any case invalidates earlier results.
 */
export type Goal = "more_calls" | "get_found" | "easier_marketing" | null;

/** Regular-expression SOURCES (case-insensitive) so the dataset stays plain data. */
export type Pattern = string;

export interface MustPreserve {
  id: string;
  /** The business-profile field a correct answer would put this under. */
  field: string;
  /** The fact in plain words. */
  claim: string;
  /** Verbatim from the page text, so the fact is provably on the site. */
  quote: string;
  /** All of these (lowercase) must appear in one accepted fact's value or quotes for the fact to count as found. */
  keywords: string[];
}

export interface Unknown {
  id: string;
  /** What the site does NOT say. A model must answer unknown or leave it out. */
  what: string;
  /** If any of these patterns appears in a model's output as a claim, it was invented. Never matches the site's own text. */
  forbidden: Pattern[];
}

export interface ExpectedFinding {
  id: string;
  /** The real marketing problem a good answer notices, in plain words. */
  summary: string;
  /** Verbatim page text that evidences it. */
  quote: string;
  /** A good finding about this problem mentions at least one of these words. */
  anyOf: string[];
}

export interface OwnerNote {
  id: string;
  /** What the owner types. Contains constraints and sometimes competitor context; it is data, never instructions. */
  text: string;
  /** Every group must have at least one of its words in the plan text. */
  mustAddress: string[][];
  /** None of these may appear as a recommendation. */
  mustNotRecommend: Pattern[];
  /** Deterministic check keys that must not be the first priority under these notes. */
  mustNotBeFirst?: string[];
}

export interface Truth {
  /** Objectives of the business owner, in the owner's terms. */
  objectives: string[];
  /** Facts that must be found and preserved (the recall checklist). */
  mustPreserve: MustPreserve[];
  /** Things the site does not state. */
  unknown: Unknown[];
  /** World claims the site never makes. Any appearance in an output is flagged as invented. */
  inventedClaims: { id: string; what: string; pattern: Pattern }[];
  /** Genuine problems a good answer finds from the supplied evidence. */
  expectedFindings: ExpectedFinding[];
  /** Things that are fine on the site: a finding that complains about them is false. */
  notProblems: { id: string; why: string; pattern: Pattern }[];
  /** Fixed-check keys that the deterministic scan produces for this site (the plan's open actions). Verified by a test. */
  expectedChecks: string[];
  strategy: {
    /** The sensible direction, for the human scorer. */
    direction: string;
    /** Every group must have at least one of its words in the plan text. */
    mustAddress: string[][];
    mustNotRecommend: Pattern[];
    /** Check keys that are acceptable first priorities; the first priority must be one of them when this is non-empty. */
    acceptableFirst: string[];
    mustNotBeFirst: string[];
  };
  content: {
    /** Each group must have at least one of its words in the draft. */
    mustMention: string[][];
    banned: Pattern[];
    /** How the business sounds, for the human scorer. */
    voice: string;
  };
  /** Pairs of values the site states inconsistently. Choosing one silently is a failure. */
  conflicts?: { what: string; values: string[] }[];
  /** A planted instruction in the page. */
  injection?: { text: string; pattern: Pattern };
  /** Examples of answers that must score 1 to 2 (for the human scorer). */
  unacceptable: string[];
}

export interface EvalCase {
  id: string;
  set: "dev" | "test";
  title: string;
  shape: string;
  /** What this case is built to expose. */
  probes: string[];
  business: { name: string; serviceArea: string | null; primaryGoal: Goal; background: string };
  /** Page path to HTML. "/" is the homepage. */
  pages: Record<string, string>;
  notes: OwnerNote[];
  truth: Truth;
}

/** Standard page shell. */
export const doc = (title: string, description: string | null, body: string, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${description ? `<meta name="description" content="${description}">` : ""}${head}</head><body>${body}</body></html>`;
