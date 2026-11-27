import { RateLimiter } from '../security/ratelimit';
import { StructuredClient } from '../providers/structured';
import { UsageMeter } from '../providers/usage';
import type { LLMProvider } from '../providers/types';
import { CampaignService } from '../capabilities/campaign';
import { CardService } from '../capabilities/cards';
import { DeliverableService } from '../capabilities/content';
import { downloadExportAdapter, ExecutionService, recordActivityAdapter, saveToWorkspaceAdapter, testEmailAdapter, type EmailSender } from '../capabilities/execution';
import { NullResearchSource, type ResearchSource } from '../capabilities/market-research';
import { PerformanceService } from '../capabilities/performance';
import { StrategyService } from '../capabilities/strategy';
import { ContextBuilder } from '../profile/context';
import { ProfileService } from '../profile/service';
import { AuditLog } from '../store/audit';
import { Authz } from '../store/authz';
import type { Db } from '../store/db';
import type { CrawlOptions } from '../website/crawler';
import { Orchestrator, type JobQueue, type OrchestratorHooks } from './orchestrator';
import { OPEN_GATE, type PlanGate } from '../plans';
import { SiteService } from '../sites';
import { BrandService } from '../brand';
import { InsightsService, ProgressService } from '../insights';

export interface AgentDeps {
  db: Db; provider: LLMProvider; queue: JobQueue; meter?: UsageMeter; crawl?: CrawlOptions; researchSource?: ResearchSource;
  emailSender?: EmailSender; limiter?: RateLimiter; hooks?: OrchestratorHooks; backoffMs?: number; gate?: PlanGate;
}

/** The single Marketing Agent: every capability shares one authorised context, one provider interface and one audit trail. */
export class Agent {
  readonly authz: Authz; readonly audit: AuditLog; readonly profiles: ProfileService; readonly context: ContextBuilder; readonly llm: StructuredClient;
  readonly cards: CardService; readonly deliverables: DeliverableService; readonly strategies: StrategyService; readonly campaigns: CampaignService;
  readonly performance: PerformanceService; readonly execution: ExecutionService; readonly orchestrator: Orchestrator;
  async campaignsSync(ctx: import('../store/authz').Ctx, id: string) { const c = await this.campaigns.get(ctx, id); return this.campaigns.syncFromDeliverables(c); }
  readonly crawl: CrawlOptions; readonly researchSource: ResearchSource; readonly db: Db;
  readonly gate: PlanGate; readonly sites: SiteService; readonly brand: BrandService; readonly insights: InsightsService; readonly progress: ProgressService;
  constructor(deps: AgentDeps) {
    this.db = deps.db; this.gate = deps.gate ?? OPEN_GATE; this.crawl = { maxPages: 8, ...deps.crawl }; this.researchSource = deps.researchSource ?? new NullResearchSource();
    this.authz = new Authz(deps.db); this.audit = new AuditLog(deps.db);
    this.profiles = new ProfileService(deps.db, this.authz, this.audit);
    this.context = new ContextBuilder(deps.db, this.authz, this.profiles);
    this.llm = new StructuredClient(deps.provider, { meter: deps.meter ?? new UsageMeter(), backoffMs: deps.backoffMs ?? 500 });
    this.cards = new CardService(deps.db, this.authz, this.audit);
    this.deliverables = new DeliverableService(deps.db, this.authz, this.audit, this.llm, this.cards, this.profiles, this.gate);
    this.sites = new SiteService(deps.db, this.authz, this.audit, this.gate);
    this.strategies = new StrategyService(deps.db, this.authz, this.audit, this.llm, this.context, this.gate);
    this.campaigns = new CampaignService(deps.db, this.authz, this.audit, this.llm, this.context, this.deliverables, this.gate);
    this.performance = new PerformanceService(deps.db, this.authz, this.audit, this.llm, this.gate);
    this.brand = new BrandService(deps.db, this.authz, this.audit, this.gate, this.sites, this.profiles, this.cards);
    this.insights = new InsightsService(deps.db, this.authz, this.gate);
    this.progress = new ProgressService(deps.db, this.authz, this.gate);
    this.execution = new ExecutionService(deps.db, this.authz, this.audit, this.cards, [saveToWorkspaceAdapter(deps.db), downloadExportAdapter(), recordActivityAdapter(this.audit)], this.gate);
    if (deps.emailSender) this.execution.register(testEmailAdapter(deps.db, deps.emailSender));
    this.orchestrator = new Orchestrator(this, deps.queue, deps.limiter ?? new RateLimiter(10, 10), deps.hooks);
  }
}
export const createAgent = (deps: AgentDeps): Agent => new Agent(deps);
