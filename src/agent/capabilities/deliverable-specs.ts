import type { DeliverableType } from '../domain/enums';
import type { ContentBlock } from '../domain/models';

export interface DeliverableSpec {
  label: string;
  /** Block keys that must exist and be non-empty for the deliverable to be "complete enough to use" (spec §8.7). */
  required: string[];
  /** Max lengths by block key. */
  maxLen?: Record<string, number>;
  guidance: string;
  usesKeywords?: boolean;
}

export const DELIVERABLE_SPECS: Record<DeliverableType, DeliverableSpec> = {
  headline_set: { label: 'Homepage headline set', required: ['headline', 'subheadline', 'cta'], maxLen: { headline: 90, subheadline: 220, cta: 40 }, guidance: 'One primary headline, supporting sentence and call to action built around the primary service and customer benefit. Add alternates as items.' },
  page_copy: { label: 'Website page rewrite', required: ['headline', 'intro', 'body', 'cta'], guidance: 'Full page rewrite using only facts in the profile and retrieved pages.' },
  service_page: { label: 'Service page', required: ['headline', 'intro', 'benefits', 'process', 'faq', 'cta', 'seo_title', 'meta_description'], maxLen: { seo_title: 60, meta_description: 160 }, guidance: 'Service page for one named service. Do not invent process steps, pricing, or credentials absent from supplied facts; put gaps in needsCustomerInput.', usesKeywords: true },
  landing_page: { label: 'Landing page', required: ['headline', 'subheadline', 'offer', 'benefits', 'cta'], guidance: 'Single-purpose landing page aligned to the campaign offer.' },
  local_landing_page: { label: 'Local landing page', required: ['headline', 'intro', 'services', 'local_proof_placeholder', 'cta', 'seo_title', 'meta_description'], maxLen: { seo_title: 60, meta_description: 160 }, guidance: 'Location-specific page. Do not fabricate local addresses, reviews, or project history.', usesKeywords: true },
  about_page: { label: 'About page', required: ['headline', 'story', 'values', 'cta'], guidance: 'Use only supplied business history; mark gaps.' },
  faq: { label: 'FAQ', required: ['questions'], guidance: 'Questions customers actually ask (profile/customer research); answers only from supplied facts.' },
  seo_meta: { label: 'SEO title and meta description', required: ['seo_title', 'meta_description'], maxLen: { seo_title: 60, meta_description: 160 }, guidance: 'Title ≤60 chars, description ≤160 chars, includes the primary topic and a reason to click. No keyword stuffing.', usesKeywords: true },
  content_brief: { label: 'Content brief', required: ['goal', 'audience', 'search_intent', 'outline', 'key_points', 'cta'], guidance: 'Brief a writer can execute. Cite supplied keyword data only if present; otherwise label keywords as proposed, not measured.', usesKeywords: true },
  blog_outline: { label: 'Blog outline', required: ['title', 'angle', 'outline'], guidance: 'Outline with headings and what each section covers.', usesKeywords: true },
  blog_article: { label: 'Blog article', required: ['title', 'intro', 'body', 'conclusion', 'cta', 'seo_title', 'meta_description'], maxLen: { seo_title: 60, meta_description: 160 }, guidance: 'Complete article. No statistics or sources unless supplied.', usesKeywords: true },
  topic_cluster: { label: 'Topic cluster', required: ['pillar', 'cluster_topics'], guidance: 'Pillar plus supporting topics with intent for each.', usesKeywords: true },
  internal_linking: { label: 'Internal linking recommendations', required: ['links'], guidance: 'From/to page pairs with anchor text, using only scanned pages.' },
  lead_magnet: { label: 'Lead magnet', required: ['title', 'format', 'outline', 'landing_headline', 'cta'], guidance: 'A useful guide/checklist concept with full outline.' },
  email: { label: 'Email', required: ['subject', 'preview', 'body', 'cta'], maxLen: { subject: 70, preview: 110 }, guidance: 'One complete email.' },
  email_sequence: { label: 'Email sequence', required: ['emails'], guidance: 'Ordered emails each with day offset, subject, preview and body (items = full emails).' },
  newsletter: { label: 'Newsletter', required: ['subject', 'intro', 'sections', 'cta'], guidance: 'Newsletter built from supplied business news/content only.' },
  social_posts: { label: 'Social posts', required: ['posts'], guidance: 'Platform-specific variations (items prefixed with platform).' },
  video_script: { label: 'Short-form video script', required: ['hook', 'script', 'cta'], guidance: 'Under 60s; hook first.' },
  content_calendar: { label: 'Content calendar', required: ['entries'], guidance: 'Dated entries with channel, topic, format.' },
  editorial_calendar: { label: 'Editorial calendar', required: ['entries'], guidance: 'Content marketing schedule with owner-neutral tasks.' },
};

export function validateBlocks(type: DeliverableType, blocks: ContentBlock[]): string | null {
  const spec = DELIVERABLE_SPECS[type];
  const byKey = new Map(blocks.map((b) => [b.key, b]));
  const missing = spec.required.filter((k) => { const b = byKey.get(k); return !b || (!b.text.trim() && !(b.items && b.items.length)); });
  if (missing.length) return `Missing or empty required blocks for ${type}: ${missing.join(', ')}. You returned blocks with keys [${blocks.map((b) => b.key).join(', ')}]; return blocks using EXACTLY the required keys [${spec.required.join(', ')}], each with non-empty "text" or "items" (for list-like blocks put one entry per item in "items", e.g. question and answer together).`;
  for (const [k, max] of Object.entries(spec.maxLen ?? {})) {
    const b = byKey.get(k);
    if (b && b.text.length > max) return `Block "${k}" is ${b.text.length} chars; maximum is ${max}`;
  }
  return null;
}
