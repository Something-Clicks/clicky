/**
 * Sample content from the approved UI reference. Shown ONLY on screens whose
 * feature has not shipped yet, and always labeled "Sample" on screen. Replace
 * with real, evidence-backed data as each phase lands; never present it as real.
 */
export const SAMPLE_ACTIONS = [
  {
    id: "sample",
    impact: "HIGH IMPACT",
    title: "Clarify your main service on the homepage",
    summary: "Help visitors understand what you do and where you work.",
    evidence: "Evidence: illustrative website finding.",
    cta: "See why it matters",
  },
  {
    id: "sample",
    impact: "MEDIUM IMPACT",
    title: "Write a clearer page title",
    summary: "Make the page topic easier to understand in search results.",
    evidence: "Evidence: illustrative metadata finding.",
    cta: "Review recommendation",
  },
] as const;

export const SAMPLE_NEXT_MOVE = {
  impact: "HIGH IMPACT",
  title: "Make your main service easier to find",
  summary:
    "Your homepage does not clearly explain the service area in the first section. This can make it harder for nearby customers to know if you serve them.",
  evidence: "Evidence: sample homepage review. Your real page and what we observed will appear here.",
} as const;

export const SAMPLE_DETAIL = {
  title: "Clarify your main service on the homepage.",
  summary: "Help a visitor understand what you do and whether you serve their area.",
  why: "People decide quickly whether a business is relevant to them. A clear first message helps them understand the offer.",
  recommended:
    "Rewrite the homepage headline and supporting line to name the main service and service area.",
  evidence: "Evidence source: your website address and the page text we observed will appear here after analysis.",
  draftHeading: "Headline draft",
  draft: "Reliable [main service] for homes and businesses in [service area].",
  draftNote: "Example placeholder. Your draft will be written from your actual business.",
} as const;

export const SAMPLE_APPROVAL = {
  title: "Google Business Profile post draft",
  source: "Prepared from the business details you provided.",
  draft: "Looking for [service] in [area]? Learn how our team can help with [customer need].",
} as const;
