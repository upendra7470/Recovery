import type {
  PaymentAccountLookupStore,
  PaymentEventStore,
} from '../domain/payment-event.js';
import type { RecoveryOpportunityStore } from '../domain/recovery-opportunity.js';

export type DbQueryTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export interface DbExecutor {
  $queryRaw: DbQueryTag;
  $disconnect?(): Promise<void>;
}

/**
 * Full database contract decorated onto the Fastify instance: raw SQL access
 * for health/readiness plus the typed store boundaries used by features.
 */
export interface AppDatabase extends DbExecutor {
  readonly paymentEvent: PaymentEventStore;
  readonly paymentAccount: PaymentAccountLookupStore;
  readonly recoveryOpportunity: RecoveryOpportunityStore;
}

export interface DbCheckOk {
  status: 'up';
}

export interface DbCheckFailed {
  status: 'down';
  reason: string;
}

export type DbCheckResult = DbCheckOk | DbCheckFailed;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function checkDatabase(db: DbExecutor, timeoutMs = 2000): Promise<DbCheckResult> {
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, timeoutMs);
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', reason: error instanceof Error ? error.message : String(error) };
  }
}
