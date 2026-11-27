import { z } from 'zod';
import { AnalysisCategory, DeliverableType, EvidenceClass, Level, TaskType } from '../domain/enums';
import { PROFILE_KEYS } from '../profile/fields';

/** Validated shapes for every model task (spec §15.3). Shared by capabilities and the mock provider. */

export const EvidenceItemSchema = z.object({
  kind: z.enum(['quote', 'metric', 'observation', 'missing']),
  source: z.string().min(1),
  text: z.string().min(1),
});

export const BusinessUnderstandingSchema = z.object({
  fields: z.array(z.object({
    key: z.enum(PROFILE_KEYS),
    value: z.union([z.string(), z.array(z.string())]),
    evidence: z.enum(['verified', 'inferred', 'unknown']),
    quote: z.string().optional(),
    sourceUrl: z.string().optional(),
  })),
  openQuestions: z.array(z.string()),
});
export type BusinessUnderstanding = z.infer<typeof BusinessUnderstandingSchema>;

export const ModelFindingSchema = z.object({
  category: AnalysisCategory,
  title: z.string().min(3).max(140),
  observed: z.string().min(3),
  where: z.array(z.string()),
  evidence: z.array(EvidenceItemSchema).min(1),
  whyItMatters: z.string().min(3),
  affected: z.string().min(2),
  consequence: z.string().min(3),
  confidence: Level,
  impact: Level,
  evidenceClass: EvidenceClass,
  missingInfo: z.array(z.string()),
  recommendation: z.string().min(3),
  effort: z.enum(['high', 'medium', 'low', 'unknown']),
  deliverableType: DeliverableType.optional(),
});
export const MarketingAnalysisSchema = z.object({ findings: z.array(ModelFindingSchema).max(12) });
export type MarketingAnalysisOutput = z.infer<typeof MarketingAnalysisSchema>;

export const MarketResearchSchema = z.object({
  findings: z.array(z.object({
    claim: z.string().min(3), evidenceClass: EvidenceClass, basis: z.string().min(3), sourceIds: z.array(z.string()),
  })),
  researchQuestions: z.array(z.string()),
});

export const CompetitorComparisonSchema = z.object({
  competitors: z.array(z.object({
    url: z.string(), name: z.string(), positioning: z.string(), offers: z.array(z.string()), ctas: z.array(z.string()),
    pricingMentions: z.array(z.string()), strengths: z.array(z.string()), weaknesses: z.array(z.string()),
  })),
  differences: z.array(z.object({ point: z.string(), evidenceClass: EvidenceClass, sources: z.array(z.string()) })),
  opportunities: z.array(z.object({ opportunity: z.string(), evidenceClass: EvidenceClass, basis: z.string() })),
});
export type CompetitorComparison = z.infer<typeof CompetitorComparisonSchema>;

export const StrategySchema = z.object({
  objectives: z.array(z.object({ objective: z.string(), metric: z.string().optional(), basis: z.string() })).min(1),
  positioning: z.array(z.string()).min(1),
  audiences: z.array(z.object({ name: z.string(), description: z.string(), evidenceClass: EvidenceClass })).min(1),
  messaging: z.array(z.string()).min(1),
  channels: z.array(z.object({ channel: z.string(), role: z.string(), rationale: z.string(), priority: Level })).min(1),
  seoStrategy: z.array(z.string()),
  contentStrategy: z.array(z.string()),
  campaignIdeas: z.array(z.object({ name: z.string(), objective: z.string(), basis: z.string() })),
  calendar: z.array(z.object({ weekOffset: z.number().int().min(0).max(52), activity: z.string(), deliverableType: DeliverableType.optional() })),
  prioritizedActions: z.array(z.object({ cardId: z.string(), rationale: z.string() })),
  assumptions: z.array(z.string()),
  constraints: z.array(z.string()),
});

export const ContentSchema = z.object({
  title: z.string().min(1),
  summary: z.string(),
  blocks: z.array(z.object({ key: z.string().min(1), label: z.string(), text: z.string(), items: z.array(z.string()).optional() })).min(1),
  assumptions: z.array(z.string()),
  needsCustomerInput: z.array(z.string()),
});
export type ContentOutput = z.infer<typeof ContentSchema>;

export const CampaignTaskTypeEnum = z.enum(['research', 'landing_page', 'email', 'social', 'content', 'distribution', 'measurement', 'review']);
export const CampaignPlanSchema = z.object({
  name: z.string(), objective: z.string(), audience: z.string(), offer: z.string(), coreMessage: z.string(),
  channels: z.array(z.string()).min(1),
  tasks: z.array(z.object({
    key: z.string().regex(/^[a-z0-9_]+$/), title: z.string(), type: CampaignTaskTypeEnum, channel: z.string().optional(),
    deliverableType: DeliverableType.optional(), description: z.string(), dependsOn: z.array(z.string()), offsetDays: z.number().int().min(0).max(365),
  })).min(2),
  measurementPlan: z.object({ goals: z.array(z.string()).min(1), metrics: z.array(z.string()).min(1), reviewOffsetsDays: z.array(z.number().int().min(1).max(365)).min(1) }),
  risks: z.array(z.string()),
});
export type CampaignPlanOutput = z.infer<typeof CampaignPlanSchema>;

export const PerformanceRecsSchema = z.object({
  summary: z.string(),
  recommendations: z.array(z.object({
    title: z.string(), rationale: z.string(), metricRefs: z.array(z.string()).min(1), confidence: Level, action: z.string(),
    deliverableType: DeliverableType.optional(),
  })),
  limitations: z.array(z.string()),
});
export type PerformanceRecsOutput = z.infer<typeof PerformanceRecsSchema>;

export const ClassifySchema = z.object({ taskType: TaskType });

export const TASKS = {
  business_understanding: BusinessUnderstandingSchema, marketing_analysis: MarketingAnalysisSchema,
  market_research: MarketResearchSchema, competitor_comparison: CompetitorComparisonSchema,
  marketing_strategy: StrategySchema, content_generation: ContentSchema, campaign_plan: CampaignPlanSchema,
  performance_recommendations: PerformanceRecsSchema, classify_request: ClassifySchema,
} as const;
export type TaskName = keyof typeof TASKS;
