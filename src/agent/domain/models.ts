import type {
  AnalysisCategory, CapabilityId, DeliverableType, EvidenceClass, Level, Provenance, Role, TaskType,
} from './enums';
import type { Row } from '../store/table';

// ---------- Tenancy ----------
export interface Location { id: string; name: string; address?: string; city?: string; state?: string; zip?: string; phone?: string; serviceAreas: string[] }
/** A website the business markets. The primary site's id === businessId. Site-level facts/brand overrides live in a profile row with id === site id. */
export interface SiteRow extends Row { name: string; url: string; domain: string; isPrimary: boolean; locations: Location[] }
export interface BusinessRow extends Row { name: string; ownerId: string; website?: string }
export interface MemberRow extends Row { userId: string; role: Role }

// ---------- Business Profile (persistent context, spec §3, §14) ----------
export interface ProfileFieldValue {
  value: string | string[];
  provenance: Provenance;
  confirmed: boolean;
  updatedAt: string;
  conflicts: { value: string | string[]; provenance: Provenance }[];
  previous: { value: string | string[]; provenance: Provenance }[];
}
/** One row per business; id === businessId. */
export interface ProfileRow extends Row { fields: Record<string, ProfileFieldValue> }

// ---------- Website intelligence ----------
export interface PageRecord {
  url: string;
  finalUrl: string;
  type: string;
  status?: number;
  ok: boolean;
  title?: string;
  metaDescription?: string;
  canonical?: string;
  robotsMeta?: string;
  lang?: string;
  viewport?: boolean;
  h1: string[]; h2: string[]; h3: string[];
  text: string;
  wordCount: number;
  images: { total: number; missingAlt: number };
  links: { href: string; text: string; internal: boolean }[];
  navLinks: string[];
  jsonLdTypes: string[];
  ctas: string[];
  formCount: number;
  phones: string[]; emails: string[];
  scriptCount: number;
  possiblyJsRendered: boolean;
  injectionSignals: string[];
  redirects: { from: string; to: string; status: number }[];
  elapsedMs: number;
}
export interface ScanFailure { url: string; code: string; message: string }
export interface WebsiteScan {
  startUrl: string;
  finalUrl?: string;
  scannedAt: string;
  completeness: 'complete' | 'partial' | 'failed';
  pages: PageRecord[];
  failures: ScanFailure[];
  limitations: string[];
  robots: { fetched: boolean; disallowedSkipped: string[]; sitemaps: string[] };
  /** Honest record of what was and was NOT tested (spec §5.2). */
  tested: { htmlRetrieved: boolean; mobileRendering: boolean; brokenLinks: boolean; coreWebVitals: boolean; javascriptRendering: boolean };
}
export interface ScanRow extends Row { siteId?: string; scan: WebsiteScan; label: 'own_site' | 'competitor'; subject?: string }

// ---------- Research library ----------
export interface ResearchRow extends Row {
  siteId?: string;
  kind: 'market' | 'competitor' | 'keyword' | 'content_gap' | 'local_seo' | 'website';
  title: string;
  data: unknown;
  evidence: EvidenceClass;
  source: string;
  collectedAt: string;
}

// ---------- Analysis & Action Cards ----------
export interface EvidenceItem { kind: 'quote' | 'metric' | 'observation' | 'missing'; source: string; text: string }
export interface Finding {
  key: string;
  category: AnalysisCategory;
  title: string;
  observed: string;
  where: string[];
  evidence: EvidenceItem[];
  whyItMatters: string;
  affected: string;
  consequence: string;
  confidence: Level;
  impact: Level;
  evidenceClass: EvidenceClass;
  missingInfo: string[];
  recommendation: string;
  effort: Level | 'unknown';
  dependsOn: string[];
  deliverableType?: DeliverableType;
  origin: 'rule' | 'model';
  ruleId?: string;
}
export interface FindingRow extends Row { siteId?: string; executionId?: string; finding: Finding; priorityScore: number }

export type CardStatus =
  | 'new' | 'drafting' | 'ready_for_review' | 'approved' | 'rejected' | 'dismissed'
  | 'authorized' | 'executing' | 'executed' | 'verified' | 'failed' | 'resolved';
export interface ActionCard {
  title: string;
  category: AnalysisCategory | 'campaign' | 'strategy' | 'performance';
  finding: string;
  evidence: EvidenceItem[];
  importance: string;
  recommendation: string;
  priority: { rank: number; score: number; label: 'critical' | 'high' | 'medium' | 'low' };
  confidence: Level;
  evidenceClass: EvidenceClass;
  estimatedEffort: Level | 'unknown';
  dependencies: string[]; // card ids
  deliverableId?: string;
  deliverableType?: DeliverableType;
  status: CardStatus;
  approval: { required: boolean; approvedBy?: string; approvedAt?: string };
  execution: { available: boolean; method: ExecutionMethod | 'none'; reason: string };
  findingKey?: string;
  dedupeKey: string;
  /** Rule findings are deterministic, so their disappearance on a fresh scan means the issue was fixed. */
  origin?: 'rule' | 'model';
}
export interface CardRow extends Row { siteId?: string; card: ActionCard; executionId?: string; decisions: { at: string; by: string; action: string; note?: string }[] }

// ---------- Deliverables ----------
export interface ContentBlock { key: string; label: string; text: string; items?: string[] }
export interface ClaimFlag { type: string; severity: 'high' | 'medium' | 'low'; excerpt: string; message: string; blockKey?: string; acknowledgedBy?: string }
export interface DeliverableVersion {
  n: number;
  title: string;
  summary: string;
  blocks: ContentBlock[];
  assumptions: string[];
  needsCustomerInput: string[];
  author: string; // 'agent' or user id
  note?: string;
  createdAt: string;
  contentHash: string;
  flags: ClaimFlag[];
  /** Produced by the development mock provider, not a real model. Such content can never be approved in production. */
  mock?: boolean;
}
export interface DeliverableRow extends Row {
  siteId?: string;
  type: DeliverableType;
  cardId?: string;
  campaignTaskKey?: string;
  campaignId?: string;
  status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'superseded';
  versions: DeliverableVersion[];
  currentVersion: number;
  approval?: { version: number; contentHash: string; approvedBy: string; approvedAt: string };
  rejection?: { by: string; at: string; reason: string };
}

// ---------- Strategy / campaigns ----------
export interface StrategyData {
  objectives: { objective: string; metric?: string; basis: string }[];
  positioning: string[];
  audiences: { name: string; description: string; evidenceClass: EvidenceClass }[];
  messaging: string[];
  channels: { channel: string; role: string; rationale: string; priority: Level }[];
  seoStrategy: string[];
  contentStrategy: string[];
  campaignIdeas: { name: string; objective: string; basis: string }[];
  calendar: { weekOffset: number; activity: string; deliverableType?: DeliverableType }[];
  prioritizedActions: { cardId: string; rationale: string }[];
  assumptions: string[];
  constraints: string[];
}
export interface StrategyRow extends Row { siteId?: string; mock?: boolean; data: StrategyData; basedOn: { cardIds: string[]; researchIds: string[]; profileVersion: number }; status: 'draft' | 'approved' | 'superseded' }

export type CampaignTaskStatus = 'blocked' | 'ready' | 'in_progress' | 'awaiting_approval' | 'done' | 'skipped';
export interface CampaignTask {
  key: string;
  title: string;
  type: 'research' | 'landing_page' | 'email' | 'social' | 'content' | 'distribution' | 'measurement' | 'review';
  channel?: string;
  deliverableType?: DeliverableType;
  deliverableId?: string;
  description: string;
  dependsOn: string[];
  offsetDays: number;
  status: CampaignTaskStatus;
}
export interface CampaignRow extends Row {
  siteId?: string;
  name: string; objective: string; audience: string; offer: string; coreMessage: string;
  channels: string[];
  tasks: CampaignTask[];
  measurementPlan: { goals: string[]; metrics: string[]; reviewOffsetsDays: number[] };
  risks: string[];
  startDate?: string;
  status: 'planning' | 'active' | 'completed' | 'cancelled';
}

// ---------- Execution ----------
export type ExecutionMethod = 'save_to_workspace' | 'download_export' | 'record_activity' | 'integration';
export type ExecActionKind =
  | 'save_to_workspace' | 'download_export' | 'record_activity'
  | 'publish_website' | 'send_email_campaign' | 'send_transactional_email' | 'schedule_social_post'
  | 'spend_ad_budget' | 'change_billing' | 'modify_account' | 'make_contract_promise' | 'commit_third_party_service';
export type ExecStatus = 'requested' | 'authorized' | 'executing' | 'executed' | 'verified' | 'failed' | 'cancelled' | 'rejected';
export interface ExecutionRequestRow extends Row {
  action: ExecActionKind;
  deliverableId: string;
  deliverableVersion: number;
  contentHash: string;
  requestedBy: string; // 'agent' | user id
  status: ExecStatus;
  idempotencyKey: string;
  authorization?: { by: string; at: string; note?: string };
  result?: { externalRef?: string; detail: string; verified: boolean; at: string };
  error?: { code: string; message: string; at: string };
  attempts: number;
  target?: Record<string, string>;
}

// ---------- Performance ----------
export interface MetricRow extends Row {
  siteId?: string;
  source: string; // ga4_manual, gsc_manual, csv_upload, email_platform_manual ...
  metric: string; // sessions, clicks, impressions, avg_position, conversions, leads, email_open_rate ...
  dimension?: string; // page / query / campaign
  periodStart: string; periodEnd: string;
  value: number;
  provenance: Provenance;
}
export interface ReportRow extends Row { siteId?: string; data: unknown; periodStart: string; periodEnd: string }

// ---------- Orchestrator ----------
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_input' | 'cancelled';
export interface StepRecord {
  capability: CapabilityId;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'degraded';
  startedAt?: string; completedAt?: string;
  attempts: number;
  summary?: string;
  error?: { code: string; message: string };
  usage: { inputTokens: number; outputTokens: number; costUsd: number; calls: number };
}
export interface WorkflowExecutionRow extends Row {
  siteId?: string;
  userId: string;
  request: string;
  taskType: TaskType;
  params: Record<string, unknown>;
  requiredCapabilities: CapabilityId[];
  status: RunStatus;
  startedAt?: string; completedAt?: string;
  steps: StepRecord[];
  state: Record<string, unknown>; // checkpoints: ids of produced artifacts
  questions: string[];
  limitations: string[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number; calls: number };
  models: string[];
  error?: { code: string; message: string };
  approvalRequirements: string[];
  idempotencyKey: string;
  mock: boolean;
}

export interface AuditRow extends Row {
  actorType: 'user' | 'agent' | 'system';
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}
export interface UsageRow extends Row { userId: string; task: string; model: string; provider: string; inputTokens: number; outputTokens: number; costUsd: number; executionId?: string }

// ---------- Product: usage, billing, previews ----------
/** One saved, completed output. Errors, blocked attempts and retries never create one (business plan: free-use rules). */
export interface UseRow extends Row { userId: string; kind: 'preview' | 'output' | 'draft'; executionId?: string; previewId?: string; task?: string; paidCredit?: boolean }
export interface BillingRow extends Row {
  userId: string; stripeCustomerId?: string; reportCredits: number;
  subscription?: { id: string; plan: 'assistant' | 'studio' | 'suite'; interval: 'month' | 'year'; status: string; currentPeriodStart: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean };
}
export interface StripeEventRow extends Row { type: string; processedAt: string }
export interface PreviewResult {
  business: { name?: string; industry?: string; services: string[]; areas: string[]; valueProposition?: string };
  findings: Finding[]; profileUpdates: { key: string; value: string | string[]; source: string; evidence: EvidenceClass; sourceRef?: string }[];
  scan: WebsiteScan; limitations: string[]; mock: boolean; pagesRead: number;
}
export interface PreviewRow extends Row {
  tokenHash: string; url: string; zip: string; ipHash: string; status: 'queued' | 'running' | 'complete' | 'failed';
  result?: PreviewResult; error?: string; claimedBy?: string; claimedBusinessId?: string;
}
export type { TaskType };
