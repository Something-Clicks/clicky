import { InMemoryTable, type Row, type Table } from './table';
import type * as M from '../domain/models';

export interface Db {
  businesses: Table<M.BusinessRow>;
  sites: Table<M.SiteRow>;
  members: Table<M.MemberRow>;
  profiles: Table<M.ProfileRow>;
  scans: Table<M.ScanRow>;
  research: Table<M.ResearchRow>;
  findings: Table<M.FindingRow>;
  cards: Table<M.CardRow>;
  deliverables: Table<M.DeliverableRow>;
  strategies: Table<M.StrategyRow>;
  campaigns: Table<M.CampaignRow>;
  executionRequests: Table<M.ExecutionRequestRow>;
  metrics: Table<M.MetricRow>;
  reports: Table<M.ReportRow>;
  workflows: Table<M.WorkflowExecutionRow>;
  audit: Table<M.AuditRow>;
  usage: Table<M.UsageRow>;
  uses: Table<M.UseRow>;
  billing: Table<M.BillingRow>;
  stripeEvents: Table<M.StripeEventRow>;
  previews: Table<M.PreviewRow>;
  /** Real Supabase only: creates organization + owner membership + profile in one call (existing create_organization RPC) and returns its id. */
  provision?(name: string, website?: string): Promise<string>;
}

export const TABLE_NAMES = [
  'businesses', 'sites', 'members', 'profiles', 'scans', 'research', 'findings', 'cards', 'deliverables', 'strategies',
  'campaigns', 'executionRequests', 'metrics', 'reports', 'workflows', 'audit', 'usage',
  'uses', 'billing', 'stripeEvents', 'previews',
] as const;

export function createInMemoryDb(): Db {
  const t = <T extends Row>(label: string): Table<T> => new InMemoryTable<T>(label);
  return {
    businesses: t('business'), sites: t('site'), members: t('member'), profiles: t('profile'), scans: t('scan'), research: t('research'),
    findings: t('finding'), cards: t('action card'), deliverables: t('deliverable'), strategies: t('strategy'),
    campaigns: t('campaign'), executionRequests: t('execution request'), metrics: t('metric'), reports: t('report'),
    workflows: t('workflow execution'), audit: t('audit event'), usage: t('usage event'),
    uses: t('use'), billing: t('billing'), stripeEvents: t('stripe event'), previews: t('preview'),
  };
}
