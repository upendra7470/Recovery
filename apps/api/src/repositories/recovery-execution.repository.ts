import type {
  ExecutionStatus,
  NewRecoveryExecutionData,
  RecoveryExecutionRow,
  RecoveryExecutionStore,
} from '../domain/recovery-execution.js';

/**
 * Persistence facade for recovery executions.
 *
 * Attribution (merchant) flows exclusively from the persisted opportunity;
 * idempotency is enforced by the database's unique constraint on
 * `idempotency_key` — concurrent duplicate requests converge to one row and
 * therefore one provider operation.
 */
export class RecoveryExecutionRepository {
  constructor(private readonly store: RecoveryExecutionStore) {}

  async create(data: NewRecoveryExecutionData): Promise<RecoveryExecutionRow> {
    return this.store.insert(data);
  }

  findByIdempotencyKey(idempotencyKey: string): Promise<RecoveryExecutionRow | null> {
    return this.store.findByIdempotencyKey(idempotencyKey);
  }

  findById(id: string): Promise<RecoveryExecutionRow | null> {
    return this.store.findById(id);
  }

  updateStatus(args: {
    id: string;
    status: ExecutionStatus;
    startedAt?: Date;
    completedAt?: Date;
    failureCode?: string | null;
    failureReason?: string | null;
  }): Promise<RecoveryExecutionRow> {
    return this.store.updateStatus(args);
  }

  /**
   * Atomic conditional transition — returns the updated row when ownership
   * was established, or null when another worker won / transition invalid.
   */
  transitionStatus(args: {
    id: string;
    from: ExecutionStatus;
    to: ExecutionStatus;
    startedAt?: Date;
    completedAt?: Date;
    failureCode?: string | null;
    failureReason?: string | null;
  }): Promise<RecoveryExecutionRow | null> {
    return this.store.transitionStatus(args);
  }

  setNextAttemptAt(args: { id: string; nextAttemptAt: Date }): Promise<RecoveryExecutionRow> {
    return this.store.setNextAttemptAt(args);
  }

  findDuePending(args: { dueBefore: Date; limit: number }): Promise<RecoveryExecutionRow[]> {
    return this.store.findDuePending(args);
  }

  findStalePending(args: { createdBefore: Date; limit: number }): Promise<RecoveryExecutionRow[]> {
    return this.store.findStalePending(args);
  }

  findActiveByOpportunity(opportunityId: string): Promise<RecoveryExecutionRow | null> {
    return this.store.findActiveByOpportunity(opportunityId);
  }

  listRecent(filters: { status?: ExecutionStatus; limit: number }): Promise<RecoveryExecutionRow[]> {
    return this.store.listRecent(filters);
  }

  countByStatus(): Promise<{ status: ExecutionStatus; count: number }[]> {
    return this.store.countByStatus();
  }

  listByOpportunity(opportunityId: string): Promise<RecoveryExecutionRow[]> {
    return this.store.listByOpportunity(opportunityId);
  }

  findLatestByOpportunityAndAction(
    opportunityId: string,
    action: RecoveryExecutionRow['action']
  ): Promise<RecoveryExecutionRow | null> {
    return this.store.findLatestByOpportunityAndAction(opportunityId, action);
  }

  countRetryAttempts(opportunityId: string): Promise<number> {
    return this.store.countRetryAttempts(opportunityId);
  }
}
