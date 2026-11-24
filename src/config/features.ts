/**
 * Customer-facing features that are built but switched off until the product is ready for them.
 * The code stays; only the screens, links and copy that expose it are hidden.
 *
 * drafts: preparing, reviewing and approving written drafts. Needs a writing engine that is not
 * connected yet (the dormant Anthropic code in src/lib/server/ai.ts and drafts.ts is NOT configured
 * and is not a dependency). Everything customers see today is produced by fixed checks.
 */
export const FEATURES = {
  drafts: false,
} as const;
