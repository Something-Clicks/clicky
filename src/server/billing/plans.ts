import { BASIC_DRAFTS, type Feature } from '@/agent/plans';

/** One central agent; these four plans only decide which of its capabilities are unlocked. */
export type PlanId = 'free' | 'report' | 'assistant' | 'studio' | 'suite';
export type SubscriptionPlan = Exclude<PlanId, 'free' | 'report'>;

const REPORT: Feature[] = ['website_review', 'findings_next_steps'];
const ASSISTANT: Feature[] = [...REPORT, 'drafts_basic', 'ongoing_reviews', 'progress_tracking', 'approval_execution', 'performance'];
const STUDIO: Feature[] = [...ASSISTANT, 'drafts_advanced', 'research_advanced', 'insights', 'strategy', 'campaigns'];
const SUITE: Feature[] = [...STUDIO, 'multi_site', 'locations', 'brand_management'];
export const PLAN_FEATURES: Record<PlanId, Feature[]> = {
  /** The free experience (3 uses) shows what the agent can do at the Assistant's drafting level, without ongoing tracking. */
  free: [...REPORT, 'drafts_basic', 'approval_execution'],
  report: REPORT, assistant: ASSISTANT, studio: STUDIO, suite: SUITE,
};
export const PLAN_NAME: Record<PlanId, string> = { free: 'Free preview', report: 'Marketing Report', assistant: 'Marketing Assistant', studio: 'Marketing Studio', suite: 'Marketing Suite' };

/** Monthly draft allowances follow the business plan's proposed quotas. Site/location allowances were "to be confirmed" there:
 *  the Suite values below are working defaults that need the owner's approval. */
export const QUOTAS: Record<SubscriptionPlan, { drafts: number; sites: number; locations: number }> = {
  assistant: { drafts: 20, sites: 1, locations: 1 }, studio: { drafts: 80, sites: 1, locations: 1 }, suite: { drafts: 250, sites: 5, locations: 25 },
};
export const FREE_USES = 3; // 1 anonymous preview + 2 after signup

/** Lowest sellable plan that includes a feature (for upgrade messages). */
export const minPlanFor = (f: Feature): string => (['report', 'assistant', 'studio', 'suite'] as PlanId[]).map((p) => p).find((p) => PLAN_FEATURES[p].includes(f)) ? PLAN_NAME[(['report', 'assistant', 'studio', 'suite'] as PlanId[]).find((p) => PLAN_FEATURES[p].includes(f))!] : PLAN_NAME.suite;

/** Approved names, prices and descriptions. The bullet lists describe ONLY what the software actually does today. */
export const CATALOG = [
  { id: 'report', product: 'marketing_report', name: 'Marketing Report', price: '$49 one-time', description: 'See what needs improvement. Get a review of your website, the most important things to fix, and clear next steps.',
    features: ['A review of your website', 'Findings, with the evidence behind each one', 'Priorities: what to fix first', 'Clear next steps', 'One review per purchase; no drafts or ongoing tracking'] },
  { id: 'assistant', product: 'marketing_assistant', name: 'Marketing Assistant', price: '$79/month', annual: '$756/year ($63/month billed annually)', description: 'Your AI marketing partner. Get regular website reviews, clear action steps, and updates you can review and approve.',
    features: ['Everything in the Marketing Report', 'Regular website reviews that mark fixed issues as resolved', `Drafts to edit and approve: ${BASIC_DRAFTS.length} types, including headlines, page copy, SEO titles, service pages, FAQs, emails and social posts`, 'Approval, action tracking and progress tracking', 'Results reporting from your Search Console or Analytics exports', 'Up to 20 drafts per month, 1 website'] },
  { id: 'studio', product: 'marketing_studio', name: 'Marketing Studio', price: '$179/month', annual: '$1,716/year ($143/month billed annually)', description: 'More ways to manage your marketing. Get deeper insights, help creating content, and more tools to put your marketing plans into action.',
    features: ['Everything in the Marketing Assistant', 'Competitor, keyword and market research', 'Insights across your competitors, search terms, audience and results', 'Advanced content: blog articles, content briefs, email sequences, newsletters, lead magnets, video scripts, calendars, local landing pages', 'A marketing plan built from your findings', 'Campaign planning, with tasks that must happen in the right order', 'Up to 80 drafts per month, 1 website'] },
  { id: 'suite', product: 'marketing_suite', name: 'Marketing Suite', price: '$399/month', annual: '$3,828/year ($319/month billed annually)', description: 'Manage all your marketing in one place. Keep your brand consistent across multiple websites and business locations.',
    features: ['Everything in the Marketing Studio', `Up to ${QUOTAS.suite.sites} websites, each with its own findings, drafts, plan and results`, `Up to ${QUOTAS.suite.locations} business locations`, 'Shared brand guidelines, with per-website overrides', 'Brand consistency checks across your websites and locations', 'Up to 250 drafts per month'] },
] as const;
