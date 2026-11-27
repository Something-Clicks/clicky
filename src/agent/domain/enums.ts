import { z } from 'zod';

/** Spec §6.3 evidence classification. */
export const EvidenceClass = z.enum(['verified', 'inferred', 'estimated', 'unknown']);
export type EvidenceClass = z.infer<typeof EvidenceClass>;

export const Level = z.enum(['high', 'medium', 'low']);
export type Level = z.infer<typeof Level>;

/** Spec §6.1 analysis categories. */
export const AnalysisCategory = z.enum([
  'brand_positioning', 'messaging', 'website_effectiveness', 'conversion', 'search_visibility',
  'seo_structure', 'content_quality', 'content_gaps', 'local_visibility', 'competitive_positioning',
  'marketing_consistency', 'customer_acquisition',
]);
export type AnalysisCategory = z.infer<typeof AnalysisCategory>;

export const ProvenanceSource = z.enum([
  'customer_confirmed', 'customer_supplied', 'manual_import', 'website', 'research', 'ai_inference', 'system',
]);
export type ProvenanceSource = z.infer<typeof ProvenanceSource>;

export const Provenance = z.object({
  source: ProvenanceSource,
  sourceRef: z.string().optional(),
  recordedAt: z.string(),
  evidence: EvidenceClass,
});
export type Provenance = z.infer<typeof Provenance>;

export const Role = z.enum(['owner', 'admin', 'editor', 'viewer']);
export type Role = z.infer<typeof Role>;

/** Spec §8 deliverable types. */
export const DeliverableType = z.enum([
  'headline_set', 'page_copy', 'service_page', 'landing_page', 'local_landing_page', 'about_page', 'faq',
  'seo_meta', 'content_brief', 'blog_outline', 'blog_article', 'topic_cluster', 'internal_linking',
  'lead_magnet', 'email', 'email_sequence', 'newsletter', 'social_posts', 'video_script',
  'content_calendar', 'editorial_calendar',
]);
export type DeliverableType = z.infer<typeof DeliverableType>;

export const TaskType = z.enum([
  'business_profile', 'website_audit', 'homepage_copy', 'competitor_research', 'seo_research',
  'marketing_plan', 'campaign', 'content_request', 'performance_review',
]);
export type TaskType = z.infer<typeof TaskType>;

export const CapabilityId = z.enum([
  'business_intelligence', 'website_intelligence', 'market_research', 'seo_intelligence',
  'marketing_analysis', 'marketing_strategy', 'content_creation', 'campaign_planning',
  'marketing_execution', 'performance_intelligence',
]);
export type CapabilityId = z.infer<typeof CapabilityId>;
