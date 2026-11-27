import { ForbiddenError } from './core/errors';
import type { DeliverableType } from './domain/enums';
import type { Ctx } from './store/authz';

/**
 * One central agent; plans only decide which capabilities are unlocked. Services call the gate before doing plan-limited
 * work, so the limits hold no matter how the work was reached (UI action, workflow, background job).
 */
export type Feature =
  | 'website_review' | 'findings_next_steps'
  | 'drafts_basic' | 'ongoing_reviews' | 'progress_tracking' | 'approval_execution' | 'performance'
  | 'drafts_advanced' | 'research_advanced' | 'insights' | 'strategy' | 'campaigns'
  | 'multi_site' | 'locations' | 'brand_management';

export const FEATURE_LABEL: Record<Feature, string> = {
  website_review: 'website review', findings_next_steps: 'findings and next steps', drafts_basic: 'marketing drafts', ongoing_reviews: 'ongoing website reviews',
  progress_tracking: 'progress tracking', approval_execution: 'approval and action tracking', performance: 'performance reporting', drafts_advanced: 'advanced content creation',
  research_advanced: 'competitor, keyword and market research', insights: 'business and market insights', strategy: 'marketing planning', campaigns: 'campaign planning',
  multi_site: 'multiple websites', locations: 'multiple business locations', brand_management: 'brand management across websites',
};

export interface PlanGate {
  has(ctx: Ctx, feature: Feature): Promise<boolean>;
  /** Throws ForbiddenError('plan_required') naming the lowest plan that includes the feature. */
  require(ctx: Ctx, feature: Feature): Promise<void>;
  /** Drafts still available in the current billing period (Infinity when the plan does not meter drafts per month). */
  draftsRemaining(ctx: Ctx): Promise<number>;
  limits(ctx: Ctx): Promise<{ maxSites: number; maxLocations: number }>;
}

/** Library default (unit tests, tooling): everything allowed. The app always supplies the real, billing-backed gate. */
export const OPEN_GATE: PlanGate = {
  async has() { return true; }, async require() { /* allowed */ }, async draftsRemaining() { return Infinity; }, async limits() { return { maxSites: 1000, maxLocations: 1000 }; },
};
export const planRequired = (feature: Feature, planName: string): ForbiddenError =>
  new ForbiddenError(`Your plan does not include ${FEATURE_LABEL[feature]}. ${planName} includes it.`, 'plan_required');

/** Draft types available from Marketing Assistant; the rest need Marketing Studio. */
export const BASIC_DRAFTS: DeliverableType[] = ['headline_set', 'page_copy', 'seo_meta', 'faq', 'about_page', 'service_page', 'email', 'social_posts'];
export const draftFeature = (t: DeliverableType): Feature => (BASIC_DRAFTS.includes(t) ? 'drafts_basic' : 'drafts_advanced');
