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
}

function eventKey(provider: string, providerEventId: string): string {
  return `${provider}:${providerEventId}`;
}
