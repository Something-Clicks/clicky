import type { CapabilityId, TaskType } from '../domain/enums';

/**
 * Workflow selection (spec §12.2): the orchestrator runs only the capabilities a request needs, in dependency order
 * (website retrieval precedes business understanding, analysis precedes strategy, planning precedes content).
 */
export const WORKFLOWS: Record<TaskType, CapabilityId[]> = {
  business_profile: ['website_intelligence', 'business_intelligence'],
  website_audit: ['website_intelligence', 'business_intelligence', 'seo_intelligence', 'marketing_analysis', 'content_creation'],
  homepage_copy: ['website_intelligence', 'business_intelligence', 'marketing_analysis', 'content_creation'],
  competitor_research: ['business_intelligence', 'market_research', 'marketing_analysis'],
  seo_research: ['website_intelligence', 'business_intelligence', 'seo_intelligence', 'marketing_analysis'],
  marketing_plan: ['website_intelligence', 'business_intelligence', 'market_research', 'seo_intelligence', 'marketing_analysis', 'marketing_strategy'],
  campaign: ['business_intelligence', 'marketing_strategy', 'campaign_planning', 'content_creation'],
  content_request: ['business_intelligence', 'content_creation'],
  performance_review: ['performance_intelligence', 'marketing_analysis', 'marketing_strategy'],
};
import type { Feature } from '../plans';
/** Minimum capability each task needs. Enforced server-side before anything is queued and again inside the services. */
export const TASK_FEATURE: Record<TaskType, Feature> = {
  business_profile: 'website_review', website_audit: 'website_review', homepage_copy: 'drafts_basic', content_request: 'drafts_basic',
  competitor_research: 'research_advanced', seo_research: 'research_advanced', marketing_plan: 'strategy', campaign: 'campaigns', performance_review: 'performance',
};
export const TASK_LABEL: Record<TaskType, string> = {
  business_profile: 'Understand my business', website_audit: 'Website marketing review', homepage_copy: 'Improve homepage messaging',
  competitor_research: 'Competitor research', seo_research: 'SEO and keyword research', marketing_plan: 'Marketing plan',
  campaign: 'Promotional campaign', content_request: 'Create marketing content', performance_review: 'Performance review',
};
/** Tasks whose completed output counts as a "use" against free/paid allowances when saved. */
export const OUTPUT_TASKS: TaskType[] = ['website_audit', 'homepage_copy', 'competitor_research', 'seo_research', 'marketing_plan', 'campaign', 'content_request', 'performance_review'];
