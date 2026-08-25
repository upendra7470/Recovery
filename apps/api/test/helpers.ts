import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { vi } from 'vitest';
import { parseEnv, type AppEnv } from '../src/config/env.js';
import type {
  AccountReference,
  NewPaymentEventData,
  PaymentAccountLookupStore,
  PaymentEventRow,
  PaymentEventStore,
} from '../src/domain/payment-event.js';
import type {
  NewRecoveryOpportunityData,
  RecoveryOpportunityRow,
  RecoveryOpportunityStore,
} from '../src/domain/recovery-opportunity.js';
import type { AppDatabase } from '../src/lib/database.js';

export function makeTestEnv(overrides: Partial<Record<keyof AppEnv, string>> = {}): AppEnv {
  return parseEnv({
    NODE_ENV: 'test',
    PORT: '4777',
    HOST: '127.0.0.1',
    DATABASE_URL:
      'postgresql://recoveryos:recoveryos_dev@localhost:5432/recoveryos?schema=public',
    LOG_LEVEL: 'silent',
    RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_123',
    ...overrides,
  });
}

export type QueryRawMock = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

export interface DbExecutorMock extends AppDatabase {
  $queryRaw: ReturnType<typeof vi.fn<QueryRawMock>>;
}

export function createDbExecutorMock(
  impl?: QueryRawMock,
  overrides: Partial<DbExecutorMock> = {}
): DbExecutorMock {
  return {
    $queryRaw: vi.fn<QueryRawMock>(impl ?? (async () => [{ ok: 1 }])),
    paymentEvent: overrides.paymentEvent ?? createPaymentEventStoreMock(),
    paymentAccount: overrides.paymentAccount ?? createAccountLookupStoreMock(),
    recoveryOpportunity:
      overrides.recoveryOpportunity ?? createRecoveryOpportunityStoreMock(),
  };
}

function sampleEventRow(overrides: Partial<PaymentEventRow> = {}): PaymentEventRow {
  return {
    id: randomUUID(),
    paymentAccountId: null,
    merchantId: null,
    provider: 'razorpay',
    providerEventId: 'payment.captured:pay_sample',
    eventType: 'payment.captured',
    providerPaymentId: 'pay_sample',
    providerOrderId: null,
    eventCreatedAt: new Date(),
    receivedAt: new Date(),
    payload: {},
    normalizedData: null,
    signatureVerified: true,
    processingStatus: 'processed',
    processingAttempts: 1,
    processedAt: new Date(),
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createPaymentEventStoreMock(
  overrides: Partial<PaymentEventStore> = {}
): PaymentEventStore {
  return {
    insert: vi.fn(async () => sampleEventRow()),
    findByProviderEventId: vi.fn(async (): Promise<PaymentEventRow | null> => null),
    findById: vi.fn(async (): Promise<PaymentEventRow | null> => null),
    findRelatedByOrderOrPayment: vi.fn(async (): Promise<PaymentEventRow[]> => []),
    ...overrides,
  };
}

export function createAccountLookupStoreMock(
  overrides: Partial<PaymentAccountLookupStore> = {}
): PaymentAccountLookupStore {
  const findActiveByExternalId = vi.fn(
    async (): Promise<AccountReference | null> => null
  );
  const findById = vi.fn(async (): Promise<AccountReference | null> => null);
  return {
    findActiveByExternalId,
    findById,
    ...overrides,
  };
}

export function createRecoveryOpportunityStoreMock(
  overrides: Partial<RecoveryOpportunityStore> = {}
): RecoveryOpportunityStore {
  return {
    insert: vi.fn(async (data: NewRecoveryOpportunityData) => sampleOpportunityRow(data)),
    findBySourceEventAndType: vi.fn(async (): Promise<RecoveryOpportunityRow | null> => null),
    findOpenByPaymentCorrelation: vi.fn(async (): Promise<RecoveryOpportunityRow[]> => []),
    findById: vi.fn(async (): Promise<RecoveryOpportunityRow | null> => null),
    list: vi.fn(async (): Promise<RecoveryOpportunityRow[]> => []),
    count: vi.fn(async () => 0),
    markRecovered: vi.fn(async ({ id }: { id: string }) => sampleOpportunityRow({ id })),
    summarizeByStatusAndCurrency: vi.fn(async () => []),
    countByType: vi.fn(async () => 0),
    ...overrides,
  };
}

/**
 * In-memory PaymentEventStore that enforces the same (provider,
 * provider_event_id) uniqueness the database guarantees, so route-level tests
 * can exercise idempotent replay without a live PostgreSQL. Production
 * idempotency relies on the real database constraint.
 */
export class InMemoryPaymentEventStore implements PaymentEventStore {
  readonly rows = new Map<string, PaymentEventRow>();
  insertCalls: NewPaymentEventData[] = [];

  async insert(data: NewPaymentEventData): Promise<PaymentEventRow> {
    this.insertCalls.push(data);
    const key = eventKey(data.provider, data.providerEventId);
    if (this.rows.has(key)) {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields (provider,providerEventId)',
        { code: 'P2002', clientVersion: 'test' }
      );
    }
    const row: PaymentEventRow = {
      ...data,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return row;
  }

  async findByProviderEventId(
    provider: PaymentEventRow['provider'],
    providerEventId: string
  ): Promise<PaymentEventRow | null> {
    return this.rows.get(eventKey(provider, providerEventId)) ?? null;
  }

  async findById(id: string): Promise<PaymentEventRow | null> {
    for (const row of this.rows.values()) {
      if (row.id === id) {
        return row;
      }
    }
    return null;
  }

  async findRelatedByOrderOrPayment(args: {
    providerPaymentId: string | null;
    providerOrderId: string | null;
    occurredAfter: Date;
    occurredBefore: Date;
  }): Promise<PaymentEventRow[]> {
    const matches: PaymentEventRow[] = [];
    for (const row of this.rows.values()) {
      const identityMatches =
        (args.providerPaymentId !== null && row.providerPaymentId === args.providerPaymentId) ||
        (args.providerOrderId !== null && row.providerOrderId === args.providerOrderId);
      if (!identityMatches) {
        continue;
      }
      if (
        row.eventCreatedAt >= args.occurredAfter &&
        row.eventCreatedAt <= args.occurredBefore
      ) {
        matches.push(row);
      }
    }
    return matches.sort((a, b) => a.eventCreatedAt.getTime() - b.eventCreatedAt.getTime());
  }
}

/**
 * In-memory RecoveryOpportunityStore enforcing the database's
 * (source_event_id, type) uniqueness so route tests exercise idempotent
 * opportunity creation without PostgreSQL.
 */
export class InMemoryRecoveryOpportunityStore implements RecoveryOpportunityStore {
  readonly rows = new Map<string, RecoveryOpportunityRow>();
  duplicateKey = false;
  insertError: Error | null = null;
  readonly markRecoveredCalls: { id: string; recoveryEventId: string; resolvedAt: Date }[] = [];

  async insert(data: NewRecoveryOpportunityData): Promise<RecoveryOpportunityRow> {
    if (this.insertError) {
      throw this.insertError;
    }
    const key = opportunityKey(data.sourceEventId, data.type);
    if (this.duplicateKey || this.rows.has(key)) {
      this.duplicateKey = false;
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields (sourceEventId,type)',
        { code: 'P2002', clientVersion: 'test' }
      );
    }
    const row: RecoveryOpportunityRow = {
      ...data,
      evidence: data.evidence,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return row;
  }

  async findBySourceEventAndType(sourceEventId: string, type: string) {
    return this.rows.get(opportunityKey(sourceEventId, type)) ?? null;
  }

  async findOpenByPaymentCorrelation(args: {
    providerPaymentId: string | null;
    providerOrderId: string | null;
  }): Promise<RecoveryOpportunityRow[]> {
    const matches: RecoveryOpportunityRow[] = [];
    for (const row of this.rows.values()) {
      if (row.status !== 'OPEN') {
        continue;
      }
      const identityMatches =
        (args.providerPaymentId !== null &&
          row.providerPaymentId === args.providerPaymentId) ||
        (args.providerOrderId !== null && row.providerOrderId === args.providerOrderId);
      if (identityMatches) {
        matches.push(row);
      }
    }
    return matches.sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());
  }

  async findById(id: string): Promise<RecoveryOpportunityRow | null> {
    for (const row of this.rows.values()) {
      if (row.id === id) {
        return row;
      }
    }
    return null;
  }

  async list(filters: { merchantId?: string; status?: string; type?: string; detectedFrom?: Date; detectedTo?: Date }) {
    const matches: RecoveryOpportunityRow[] = [];
    for (const row of this.rows.values()) {
      if (filters.merchantId !== undefined && row.merchantId !== filters.merchantId) {
        continue;
      }
      if (filters.status !== undefined && row.status !== filters.status) {
        continue;
      }
      if (filters.type !== undefined && row.type !== filters.type) {
        continue;
      }
      if (filters.detectedFrom !== undefined && row.detectedAt < filters.detectedFrom) {
        continue;
      }
      if (filters.detectedTo !== undefined && row.detectedAt > filters.detectedTo) {
        continue;
      }
      matches.push(row);
    }
    return matches.sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
  }

  async count(filters: { merchantId?: string; status?: string; type?: string; detectedFrom?: Date; detectedTo?: Date }) {
    return (await this.list(filters)).length;
  }

  async markRecovered(args: { id: string; recoveryEventId: string; resolvedAt: Date }) {
    this.markRecoveredCalls.push(args);
    for (const [key, row] of this.rows.entries()) {
      if (row.id === args.id) {
        const updated: RecoveryOpportunityRow = {
          ...row,
          status: 'RECOVERED',
          recoveryEventId: args.recoveryEventId,
          resolvedAt: args.resolvedAt,
          updatedAt: new Date(),
        };
        this.rows.set(key, updated);
        return updated;
      }
    }
    throw new Error(`Opportunity ${args.id} not found`);
  }

  async summarizeByStatusAndCurrency(_merchantId?: string): Promise<
    { status: RecoveryOpportunityRow['status']; currency: string; count: number; totalAmountAtRisk: number }[]
  > {
    const totals = new Map<string, { status: RecoveryOpportunityRow['status']; currency: string; count: number; totalAmountAtRisk: number }>();
    for (const row of this.rows.values()) {
      if (_merchantId !== undefined && row.merchantId !== _merchantId) {
        continue;
      }
      const key = `${row.status}:${row.currency}`;
      const entry = totals.get(key) ?? {
        status: row.status,
        currency: row.currency,
        count: 0,
        totalAmountAtRisk: 0,
      };
      entry.count += 1;
      entry.totalAmountAtRisk += row.amountAtRisk;
      totals.set(key, entry);
    }
    return [...totals.values()];
  }

  async countByType(type: string, merchantId?: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (merchantId !== undefined && row.merchantId !== merchantId) {
        continue;
      }
      if (row.type === type) {
        count += 1;
      }
    }
    return count;
  }
}

function sampleOpportunityRow(overrides: Partial<RecoveryOpportunityRow> = {}): RecoveryOpportunityRow {
  return {
    id: randomUUID(),
    merchantId: null,
    paymentAccountId: null,
    type: 'FAILED_PAYMENT',
    status: 'OPEN',
    sourceEventId: randomUUID(),
    providerPaymentId: 'pay_sample',
    providerOrderId: 'order_sample',
    amountAtRisk: 50000,
    currency: 'INR',
    reason: 'Sample reason',
    evidence: {},
    recoveryEventId: null,
    detectedAt: new Date(),
    expiresAt: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function eventKey(provider: string, providerEventId: string): string {
  return `${provider}:${providerEventId}`;
}

function opportunityKey(sourceEventId: string, type: string): string {
  return `${sourceEventId}:${type}`;
}
