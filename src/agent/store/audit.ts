import type { Db } from './db';

export interface AuditInput {
  businessId: string;
  actorType: 'user' | 'agent' | 'system';
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}
/** Append-only audit trail (no update/delete exposed). */
export class AuditLog {
  constructor(private readonly db: Db) {}
  async record(e: AuditInput): Promise<void> {
    await this.db.audit.insert({ ...e });
  }
  list(businessId: string, where?: Record<string, unknown>) {
    return this.db.audit.list(businessId, where);
  }
}
