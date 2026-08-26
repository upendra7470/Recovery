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
import type {
  DecisionPriority,
  NewRecoveryDecisionData,
  RecommendedAction,
  RecoveryDecisionRow,
  RecoveryDecisionStore,
} from '../src/domain/recovery-decision.js';
import type {
  NewRecoveryAIAdviceData,
  RecoveryAIAdviceRow,
  RecoveryAIAdviceStore,
  RecoveryAIAdvisor,
  AIAdvisorResult,
  RecoveryAIAdviceRequest,
  RecoveryAIAdviceContent,
} from '../src/domain/recovery-ai-advice.js';
import type {
  CreateMembershipInput,
  CreateSessionInput,
  CreateUserInput,
} from '../src/domain/authentication.js';
import type {
  ExecutionStatus,
  NewRecoveryExecutionData,
  RecoveryExecutionRow,
  RecoveryExecutionStore,
  RecoveryExecutionProvider,
  RetryPaymentRequest,
  RetryPaymentResult,
} from '../src/domain/recovery-execution.js';
import type {
  AuthenticationStore,
  MerchantMembershipRow,
  SessionRow,
  UserRow,
} from '../src/domain/authentication.js';
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

export function createAuthenticationStoreMock(
  overrides: Partial<AuthenticationStore> = {}
): AuthenticationStore {
  return {
    findUserByEmail: vi.fn(async (): Promise<UserRow | null> => null),
    createUser: vi.fn(async (input: CreateUserInput) => ({
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findMembershipsByUser: vi.fn(async (): Promise<MerchantMembershipRow[]> => []),
    findMembership: vi.fn(async (): Promise<MerchantMembershipRow | null> => null),
    createMembership: vi.fn(async (input: CreateMembershipInput) => ({
      id: randomUUID(),
      userId: input.userId,
      merchantId: input.merchantId,
      role: input.role,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    createSession: vi.fn(async (input: CreateSessionInput) => ({
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    findActiveSessionByTokenHash: vi.fn(async (): Promise<{ session: SessionRow; user: UserRow; memberships: MerchantMembershipRow[] } | null> => null),
    revokeSession: vi.fn(async () => {}),
    ...overrides,
  };
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
    recoveryDecision:
      overrides.recoveryDecision ?? createRecoveryDecisionStoreMock(),
    recoveryAIAdvice:
      overrides.recoveryAIAdvice ?? createRecoveryAIAdviceStoreMock(),
    recoveryExecution:
      overrides.recoveryExecution ?? createRecoveryExecutionStoreMock(),
    auth: overrides.auth ?? createAuthenticationStoreMock(),
  };
}

export function createRecoveryExecutionStoreMock(
  overrides: Partial<RecoveryExecutionStore> = {}
): RecoveryExecutionStore {
  return {
    insert: vi.fn(async (data: NewRecoveryExecutionData) => sampleExecutionRow(data)),
    findByIdempotencyKey: vi.fn(async (): Promise<RecoveryExecutionRow | null> => null),
    findById: vi.fn(async (): Promise<RecoveryExecutionRow | null> => null),
    updateStatus: vi.fn(async ({ id }: { id: string; status: ExecutionStatus }) =>
      sampleExecutionRow({ id })
    ),
    transitionStatus: vi.fn(
      async ({ id }: { id: string; from: ExecutionStatus; to: ExecutionStatus }) =>
        sampleExecutionRow({ id })
    ),
    setNextAttemptAt: vi.fn(async ({ id }: { id: string }) => sampleExecutionRow({ id })),
    listByOpportunity: vi.fn(async (): Promise<RecoveryExecutionRow[]> => []),
    findLatestByOpportunityAndAction: vi.fn(async (): Promise<RecoveryExecutionRow | null> => null),
    findActiveByOpportunity: vi.fn(async (): Promise<RecoveryExecutionRow | null> => null),
    findDuePending: vi.fn(async (): Promise<RecoveryExecutionRow[]> => []),
    findStalePending: vi.fn(async (): Promise<RecoveryExecutionRow[]> => []),
    listRecent: vi.fn(async (): Promise<RecoveryExecutionRow[]> => []),
    countByStatus: vi.fn(async () => []),
    countRetryAttempts: vi.fn(async () => 0),
    ...overrides,
  };
}

export function createRecoveryAIAdviceStoreMock(
  overrides: Partial<RecoveryAIAdviceStore> = {}
): RecoveryAIAdviceStore {
  return {
    upsert: vi.fn(async (data: NewRecoveryAIAdviceData) => sampleAdviceRow(data)),
    findByDecision: vi.fn(async (): Promise<RecoveryAIAdviceRow | null> => null),
    ...overrides,
  };
}

export function createRecoveryDecisionStoreMock(
  overrides: Partial<RecoveryDecisionStore> = {}
): RecoveryDecisionStore {
  return {
    upsert: vi.fn(async (data: NewRecoveryDecisionData) => sampleDecisionRow(data)),
    findById: vi.fn(async (): Promise<RecoveryDecisionRow | null> => null),
    findByOpportunityAndEngineVersion: vi.fn(
      async (): Promise<RecoveryDecisionRow | null> => null
    ),
    findLatestByOpportunityIds: vi.fn(async (): Promise<RecoveryDecisionRow[]> => []),
    countByPriority: vi.fn(async () => 0),
    countByRecommendedAction: vi.fn(async () => 0),
    averageConfidence: vi.fn(async () => null),
    ...overrides,
  };
}

/**
 * In-memory RecoveryDecisionStore enforcing the database's
 * (opportunity_id, engine_version) uniqueness with upsert semantics so route
 * and service tests exercise re-evaluation without PostgreSQL.
 */
export class InMemoryRecoveryDecisionStore implements RecoveryDecisionStore {
  readonly rows = new Map<string, RecoveryDecisionRow>();
  upsertCalls: NewRecoveryDecisionData[] = [];

  async findById(id: string): Promise<RecoveryDecisionRow | null> {
    for (const row of this.rows.values()) {
      if (row.id === id) {
        return row;
      }
    }
    return null;
  }

  async upsert(data: NewRecoveryDecisionData): Promise<RecoveryDecisionRow> {
    this.upsertCalls.push(data);
    const key = decisionKey(data.opportunityId, data.engineVersion);
    const existing = this.rows.get(key);
    if (existing !== undefined) {
      const updated: RecoveryDecisionRow = {
        ...existing,
        score: data.score,
        priority: data.priority,
        confidence: data.confidence,
        recommendedAction: data.recommendedAction,
        reasons: [...data.reasons],
        factors: [...data.factors],
        riskFlags: [...data.riskFlags],
        evaluatedAt: data.evaluatedAt,
        merchantId: data.merchantId,
        updatedAt: new Date(),
      };
      this.rows.set(key, updated);
      return updated;
    }
    const row: RecoveryDecisionRow = {
      ...data,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return row;
  }

  async findByOpportunityAndEngineVersion(
    opportunityId: string,
    engineVersion: string
  ): Promise<RecoveryDecisionRow | null> {
    return this.rows.get(decisionKey(opportunityId, engineVersion)) ?? null;
  }

  async findLatestByOpportunityIds(opportunityIds: readonly string[]): Promise<RecoveryDecisionRow[]> {
    const matches: RecoveryDecisionRow[] = [];
    for (const row of this.rows.values()) {
      if (opportunityIds.includes(row.opportunityId)) {
        matches.push(row);
      }
    }
    return matches.sort((a, b) => b.evaluatedAt.getTime() - a.evaluatedAt.getTime());
  }

  async countByPriority(priority: DecisionPriority, merchantId?: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (merchantId !== undefined && row.merchantId !== merchantId) {
        continue;
      }
      if (row.priority === priority) {
        count += 1;
      }
    }
    return count;
  }

  async countByRecommendedAction(action: RecommendedAction, merchantId?: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (merchantId !== undefined && row.merchantId !== merchantId) {
        continue;
      }
      if (row.recommendedAction === action) {
        count += 1;
      }
    }
    return count;
  }

  async averageConfidence(merchantId?: string): Promise<number | null> {
    let total = 0;
    let count = 0;
    for (const row of this.rows.values()) {
      if (merchantId !== undefined && row.merchantId !== merchantId) {
        continue;
      }
      total += row.confidence;
      count += 1;
    }
    return count === 0 ? null : Math.round((total / count) * 100) / 100;
  }
}

function sampleDecisionRow(overrides: Partial<RecoveryDecisionRow> = {}): RecoveryDecisionRow {  return {
    id: randomUUID(),
    merchantId: null,
    opportunityId: randomUUID(),
    engineVersion: 'v1',
    score: 50,
    priority: 'MEDIUM',
    confidence: 50,
    recommendedAction: 'REVIEW',
    reasons: ['Sample reason'],
    factors: [],
    riskFlags: [],
    evaluatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
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
    outcomeStatsByType: vi.fn(async () => ({ total: 0, recovered: 0 })),
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

  async outcomeStatsByType(type: string): Promise<{ total: number; recovered: number }> {
    let total = 0;
    let recovered = 0;
    for (const row of this.rows.values()) {
      if (row.type !== type) {
        continue;
      }
      total += 1;
      if (row.status === 'RECOVERED') {
        recovered += 1;
      }
    }
    return { total, recovered };
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

function decisionKey(opportunityId: string, engineVersion: string): string {
  return `${opportunityId}:${engineVersion}`;
}

function sampleAdviceRow(overrides: Partial<RecoveryAIAdviceRow> = {}): RecoveryAIAdviceRow {
  return {
    id: randomUUID(),
    merchantId: null,
    opportunityId: randomUUID(),
    decisionId: randomUUID(),
    provider: 'fake',
    model: 'fake-model',
    advisorVersion: 'v1',
    promptVersion: 'v1',
    status: 'AVAILABLE',
    summary: 'Sample AI summary.',
    explanation: 'Sample AI explanation with sufficient length for validation.',
    nextStep: 'Proceed per the authoritative decision.',
    customerMessage: null,
    operatorMessage: null,
    confidence: 70,
    warnings: [],
    safetyConstrained: false,
    decisionFingerprint: 'fingerprint-placeholder',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * In-memory RecoveryAIAdviceStore enforcing the database's
 * (decision_id, advisor_version, model) uniqueness with upsert semantics.
 */
export class InMemoryRecoveryAIAdviceStore implements RecoveryAIAdviceStore {
  readonly rows = new Map<string, RecoveryAIAdviceRow>();
  upsertCalls: NewRecoveryAIAdviceData[] = [];

  async upsert(data: NewRecoveryAIAdviceData): Promise<RecoveryAIAdviceRow> {
    this.upsertCalls.push(data);
    const key = adviceKey(data.decisionId, data.advisorVersion, data.model);
    const existing = this.rows.get(key);
    if (existing !== undefined) {
      const updated: RecoveryAIAdviceRow = {
        ...existing,
        summary: data.summary,
        explanation: data.explanation,
        nextStep: data.nextStep,
        customerMessage: data.customerMessage,
        operatorMessage: data.operatorMessage,
        confidence: data.confidence,
        warnings: [...data.warnings],
        safetyConstrained: data.safetyConstrained,
        decisionFingerprint: data.decisionFingerprint,
        merchantId: data.merchantId,
        updatedAt: new Date(),
      };
      this.rows.set(key, updated);
      return updated;
    }
    const row: RecoveryAIAdviceRow = {
      ...data,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return row;
  }

  async findByDecision(args: {
    decisionId: string;
    advisorVersion: string;
    model: string;
  }): Promise<RecoveryAIAdviceRow | null> {
    return this.rows.get(adviceKey(args.decisionId, args.advisorVersion, args.model)) ?? null;
  }
}

/** Deterministic valid content builders for fake advisors/tests. */
export function makeAdviceContent(
  overrides: Partial<RecoveryAIAdviceContent> = {}
): RecoveryAIAdviceContent {
  return {
    summary: 'Transient gateway failure shortly after checkout.',
    explanation:
      'The failure looks transient and the deterministic decision to retry is consistent with the observed evidence and low attempt count.',
    nextStep: 'Schedule one retry within the standard backoff window.',
    customerMessage: null,
    operatorMessage: null,
    confidence: 72,
    warnings: [],
    ...overrides,
  };
}

type FakeAdvisorBehavior =
  | { kind: 'success'; content?: Partial<RecoveryAIAdviceContent> }
  | { kind: 'timeout' }
  | { kind: 'rate_limited' }
  | { kind: 'provider_error' }
  | { kind: 'network_error' }
  | { kind: 'invalid_response_malformed_json' }
  | { kind: 'invalid_response_schema' }
  | { kind: 'throw' };

/**
 * Configurable deterministic fake advisor — lets tests simulate success,
 * every unavailability mode, conflicting/unsafe text and malformed output
 * without any network access or real provider.
 */
export class FakeAIRecoveryAdvisor implements RecoveryAIAdvisor {
  readonly provider = 'fake';
  calls: RecoveryAIAdviceRequest[] = [];

  constructor(private behavior: FakeAdvisorBehavior = { kind: 'success' }) {}

  setBehavior(behavior: FakeAdvisorBehavior): void {
    this.behavior = behavior;
  }

  async advise(request: RecoveryAIAdviceRequest): Promise<AIAdvisorResult> {
    this.calls.push(request);
    switch (this.behavior.kind) {
      case 'success':
        return { status: 'available', content: makeAdviceContent(this.behavior.content) };
      case 'timeout':
        return { status: 'unavailable', reason: 'timeout' };
      case 'rate_limited':
        return { status: 'unavailable', reason: 'rate_limited' };
      case 'provider_error':
        return { status: 'unavailable', reason: 'provider_error' };
      case 'network_error':
        return { status: 'unavailable', reason: 'network_error' };
      case 'invalid_response_malformed_json':
      case 'invalid_response_schema':
        return { status: 'unavailable', reason: 'invalid_response' };
      case 'throw':
        throw new Error('synthetic advisor crash');
    }
  }
}

function adviceKey(decisionId: string, advisorVersion: string, model: string): string {
  return `${decisionId}:${advisorVersion}:${model}`;
}

function sampleExecutionRow(overrides: Partial<RecoveryExecutionRow> = {}): RecoveryExecutionRow {
  return {
    id: randomUUID(),
    merchantId: null,
    opportunityId: randomUUID(),
    decisionId: randomUUID(),
    action: 'RETRY',
    status: 'PENDING',
    origin: 'MANUAL',
    nextAttemptAt: null,
    scheduledAt: null,
    attempt: 1,
    idempotencyKey: `key-${randomUUID()}`,
    provider: null,
    providerPaymentId: 'pay_sample',
    requestedAt: new Date(),
    startedAt: null,
    completedAt: null,
    failureCode: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * In-memory RecoveryExecutionStore enforcing the database's unique
 * `idempotency_key` constraint so duplicate-execution tests behave exactly
 * like PostgreSQL without a live database.
 */
export class InMemoryRecoveryExecutionStore implements RecoveryExecutionStore {
  readonly rows = new Map<string, RecoveryExecutionRow>();

  async insert(data: NewRecoveryExecutionData): Promise<RecoveryExecutionRow> {
    if (this.rows.has(data.idempotencyKey)) {
      throw new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields (idempotencyKey)',
        { code: 'P2002', clientVersion: 'test' }
      );
    }
    const row: RecoveryExecutionRow = {
      ...data,
      origin: data.origin ?? 'MANUAL',
      nextAttemptAt: data.nextAttemptAt ?? null,
      scheduledAt: data.scheduledAt ?? null,
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(data.idempotencyKey, row);
    return row;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<RecoveryExecutionRow | null> {
    return this.rows.get(idempotencyKey) ?? null;
  }

  async findById(id: string): Promise<RecoveryExecutionRow | null> {
    for (const row of this.rows.values()) {
      if (row.id === id) {
        return row;
      }
    }
    return null;
  }

  async transitionStatus(args: {
    id: string;
    from: ExecutionStatus;
    to: ExecutionStatus;
    startedAt?: Date;
    completedAt?: Date;
    failureCode?: string | null;
    failureReason?: string | null;
  }): Promise<RecoveryExecutionRow | null> {
    for (const [key, row] of this.rows.entries()) {
      if (row.id === args.id && row.status === args.from) {
        const updated: RecoveryExecutionRow = {
          ...row,
          status: args.to,
          startedAt: args.startedAt ?? row.startedAt,
          completedAt: args.completedAt ?? row.completedAt,
          failureCode: args.failureCode !== undefined ? args.failureCode : row.failureCode,
          failureReason:
            args.failureReason !== undefined ? args.failureReason : row.failureReason,
          updatedAt: new Date(),
        };
        this.rows.set(key, updated);
        return updated;
      }
    }
    return null;
  }

  async setNextAttemptAt(args: { id: string; nextAttemptAt: Date }): Promise<RecoveryExecutionRow> {
    for (const [key, row] of this.rows.entries()) {
      if (row.id === args.id) {
        const updated: RecoveryExecutionRow = {
          ...row,
          nextAttemptAt: args.nextAttemptAt,
          updatedAt: new Date(),
        };
        this.rows.set(key, updated);
        return updated;
      }
    }
    throw new Error(`Execution ${args.id} not found`);
  }

  async updateStatus(args: {
    id: string;
    status: ExecutionStatus;
    startedAt?: Date;
    completedAt?: Date;
    failureCode?: string | null;
    failureReason?: string | null;
  }): Promise<RecoveryExecutionRow> {
    for (const [key, row] of this.rows.entries()) {
      if (row.id === args.id) {
        const updated: RecoveryExecutionRow = {
          ...row,
          status: args.status,
          startedAt: args.startedAt ?? row.startedAt,
          completedAt: args.completedAt ?? row.completedAt,
          failureCode: args.failureCode !== undefined ? args.failureCode : row.failureCode,
          failureReason:
            args.failureReason !== undefined ? args.failureReason : row.failureReason,
          updatedAt: new Date(),
        };
        this.rows.set(key, updated);
        return updated;
      }
    }
    throw new Error(`Execution ${args.id} not found`);
  }

  async listByOpportunity(opportunityId: string): Promise<RecoveryExecutionRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.opportunityId === opportunityId)
      .sort((a, b) => b.attempt - a.attempt || b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findLatestByOpportunityAndAction(
    opportunityId: string,
    action: RecoveryExecutionRow['action']
  ): Promise<RecoveryExecutionRow | null> {
    const matches = [...this.rows.values()]
      .filter((row) => row.opportunityId === opportunityId && row.action === action)
      .sort((a, b) => b.attempt - a.attempt || b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }

  async findActiveByOpportunity(opportunityId: string): Promise<RecoveryExecutionRow | null> {
    const ACTIVE: ExecutionStatus[] = ['PENDING', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED'];
    const matches = [...this.rows.values()]
      .filter((row) => row.opportunityId === opportunityId && ACTIVE.includes(row.status))
      .sort((a, b) => b.attempt - a.attempt || b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ?? null;
  }

  async findDuePending(args: { dueBefore: Date; limit: number }): Promise<RecoveryExecutionRow[]> {
    const due = [...this.rows.values()].filter(
      (row) =>
        row.status === 'PENDING' &&
        (row.nextAttemptAt ?? row.requestedAt) <= args.dueBefore
    );
    due.sort((a, b) => {
      const aDue = (a.nextAttemptAt ?? a.requestedAt).getTime();
      const bDue = (b.nextAttemptAt ?? b.requestedAt).getTime();
      return aDue - bDue;
    });
    return due.slice(0, args.limit);
  }

  async findStalePending(args: { createdBefore: Date; limit: number }): Promise<RecoveryExecutionRow[]> {
    return [...this.rows.values()]
      .filter(
        (row) => row.status === 'PENDING' && row.createdAt < args.createdBefore
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, args.limit);
  }

  async listRecent(filters: { status?: ExecutionStatus; limit: number }): Promise<RecoveryExecutionRow[]> {
    return [...this.rows.values()]
      .filter((row) => filters.status === undefined || row.status === filters.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, filters.limit);
  }

  async countByStatus(): Promise<{ status: ExecutionStatus; count: number }[]> {
    const counts = new Map<ExecutionStatus, number>();
    for (const row of this.rows.values()) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    }
    return [...counts.entries()].map(([status, count]) => ({ status, count }));
  }

  async countRetryAttempts(opportunityId: string): Promise<number> {
    return [...this.rows.values()].filter(
      (row) => row.opportunityId === opportunityId && row.action === 'RETRY' && row.status !== 'BLOCKED'
    ).length;
  }
}

type FakeProviderBehavior =
  | { kind: 'accepted' }
  | { kind: 'rejected'; failureCode?: string; failureReason?: string }
  | { kind: 'unavailable'; reason?: string }
  | { kind: 'throw' };

/** Deterministic fake execution provider for tests (no network). */
export class FakeRecoveryExecutionProvider implements RecoveryExecutionProvider {
  readonly provider = 'fake';
  calls: RetryPaymentRequest[] = [];

  constructor(private behavior: FakeProviderBehavior = { kind: 'accepted' }) {}

  setBehavior(behavior: FakeProviderBehavior): void {
    this.behavior = behavior;
  }

  async retryPayment(request: RetryPaymentRequest): Promise<RetryPaymentResult> {
    this.calls.push(request);
    switch (this.behavior.kind) {
      case 'accepted':
        return { kind: 'accepted', providerReferenceId: `ref_${request.executionId}` };
      case 'rejected':
        return {
          kind: 'rejected',
          failureCode: this.behavior.failureCode ?? 'payment_declined',
          failureReason: this.behavior.failureReason ?? 'The provider declined the retry.',
        };
      case 'unavailable':
        return { kind: 'unavailable', reason: this.behavior.reason ?? 'timeout' };
      case 'throw':
        throw new Error('synthetic provider crash');
    }
  }
}
