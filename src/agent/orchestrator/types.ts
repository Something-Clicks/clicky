import type { CapabilityId, TaskType } from '../domain/enums';
import type { Finding, WorkflowExecutionRow } from '../domain/models';
import type { Usage } from '../providers/usage';
import type { Ctx } from '../store/authz';
import type { Agent } from './agent';

export interface Params {
  url?: string; zip?: string; competitorUrls?: string[]; keywordCsv?: string; keywordSource?: string;
  deliverableType?: string; goal?: string; offer?: string; notes?: string;
  periodCurrent?: { start: string; end: string }; periodPrevious?: { start: string; end: string };
  rescan?: boolean; maxPages?: number;
  /** Review only: skip preparing drafts (scheduled reviews). */
  noDrafts?: boolean;
}
/** Checkpoint state persisted on the execution row: ids of produced artefacts + small intermediates. */
export interface RunState {
  scanId?: string; competitorScanIds?: string[]; researchIds?: string[]; cardIds?: string[]; focusCardIds?: string[];
  deliverableIds?: string[]; strategyId?: string; campaignId?: string; reportId?: string;
  seoFindings?: Finding[]; competitorFindings?: Finding[]; profileApplied?: string[]; profileConflicts?: string[]; downgraded?: string[]; findingCount?: number;
  [k: string]: unknown;
}
export interface RunEnv {
  agent: Agent; ctx: Ctx; exec: WorkflowExecutionRow; params: Params; state: RunState;
  usage: { current: Usage }; limitations: string[]; questions: string[]; mock: { value: boolean }; models: Set<string>;
}
export interface CapabilityDef {
  id: CapabilityId;
  /** Failure of an optional capability degrades the run instead of failing it. */
  optional?: boolean | ((taskType: TaskType) => boolean);
  /** Cheap, model-free check of required inputs. Returns questions for the customer when something essential is missing. */
  preflight?(a: { agent: Agent; ctx: Ctx; params: Params; taskType: TaskType; request: string }): Promise<string[]>;
  run(env: RunEnv): Promise<string>;
}
