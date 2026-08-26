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
