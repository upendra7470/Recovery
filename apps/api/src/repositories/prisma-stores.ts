import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AccountReference,
  PaymentAccountLookupStore,
  PaymentEventRow,
  PaymentEventStore,
  PaymentProviderName,
} from '../domain/payment-event.js';
import type {
  NewRecoveryOpportunityData,
  OpportunityFilters,
  RecoveryOpportunityRow,
  RecoveryOpportunityStore,
} from '../domain/recovery-opportunity.js';
import type {
  DecisionFactor,
  DecisionRiskFlagDetail,
  NewRecoveryDecisionData,
  RecoveryDecisionRow,
  RecoveryDecisionStore,
} from '../domain/recovery-decision.js';
import type {
  AIAdviceStatus,
  RecoveryAIAdviceRow,
  RecoveryAIAdviceStore,
} from '../domain/recovery-ai-advice.js';
import type {
  ExecutionStatus,
  NewRecoveryExecutionData,
  RecoveryExecutionRow,
  RecoveryExecutionStore,
} from '../domain/recovery-execution.js';
import type {
  MerchantMemoryOverview,
  MerchantMemoryStrategy,
  MerchantMemoryEvidence,
  MerchantStrategyMemoryRow,
  MerchantStrategyMemoryStore,
} from '../domain/merchant-memory.js';

/**
 * Prisma-backed implementations of the ingestion/detection store boundaries.
 * These are the ONLY places where Prisma delegates are touched; the rest of
 * the app depends on the domain interfaces.
 */

function toAccountReference(row: { id: string; merchantId: string }): AccountReference {
  return { id: row.id, merchantId: row.merchantId };
}

export function createPrismaPaymentEventStore(client: PrismaClient): PaymentEventStore {
  return {
    async insert(data) {
      const row: PaymentEventRow = await client.paymentEvent.create({ data });
      return row;
    },
    async findByProviderEventId(provider: PaymentProviderName, providerEventId: string) {
      const row = await client.paymentEvent.findFirst({
        where: { provider, providerEventId },
      });
      return row ?? null;
    },
    async findById(id: string) {
      const row = await client.paymentEvent.findUnique({ where: { id } });
      return row ?? null;
    },
    async findRelatedByOrderOrPayment({ providerPaymentId, providerOrderId, occurredAfter, occurredBefore }) {
      const identities: { providerPaymentId?: string; providerOrderId?: string }[] = [];
      if (providerPaymentId !== null) {
        identities.push({ providerPaymentId });
      }
      if (providerOrderId !== null) {
        identities.push({ providerOrderId });
      }
      if (identities.length === 0) {
        return [];
      }
      const rows = await client.paymentEvent.findMany({
        where: {
          OR: identities,
          eventCreatedAt: { gte: occurredAfter, lte: occurredBefore },
        },
        orderBy: { eventCreatedAt: 'asc' },
      });
      return rows;
    },
  };
}

export function createPrismaPaymentAccountLookupStore(
  client: PrismaClient
): PaymentAccountLookupStore {
  return {
    async findActiveByExternalId(provider: PaymentProviderName, externalAccountId: string) {
      const row = await client.paymentAccount.findFirst({
        where: { provider, externalAccountId, status: 'active' },
        select: { id: true, merchantId: true },
      });
      return row ? toAccountReference(row) : null;
    },
    async findById(id: string) {
      const row = await client.paymentAccount.findUnique({
        where: { id },
        select: { id: true, merchantId: true },
      });
      return row ? toAccountReference(row) : null;
    },
  };
}

function toOpportunityWhere(filters: OpportunityFilters) {
  return {
    ...(filters.merchantId !== undefined ? { merchantId: filters.merchantId } : {}),
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.type !== undefined ? { type: filters.type } : {}),
    ...(filters.detectedFrom !== undefined || filters.detectedTo !== undefined
      ? {
          detectedAt: {
            ...(filters.detectedFrom !== undefined ? { gte: filters.detectedFrom } : {}),
            ...(filters.detectedTo !== undefined ? { lte: filters.detectedTo } : {}),
          },
        }
      : {}),
  };
}

export function createPrismaRecoveryOpportunityStore(
  client: PrismaClient
): RecoveryOpportunityStore {
  return {
    async insert(data: NewRecoveryOpportunityData) {
      const row: RecoveryOpportunityRow = await client.recoveryOpportunity.create({ data });
      return row;
    },
    async findBySourceEventAndType(sourceEventId, type) {
      const row = await client.recoveryOpportunity.findFirst({
        where: { sourceEventId, type },
      });
      return row ?? null;
    },
    async findOpenByPaymentCorrelation({ providerPaymentId, providerOrderId }) {
      const identities: { providerPaymentId?: string; providerOrderId?: string }[] = [];
      if (providerPaymentId !== null) {
        identities.push({ providerPaymentId });
      }
      if (providerOrderId !== null) {
        identities.push({ providerOrderId });
      }
      if (identities.length === 0) {
        return [];
      }
      const rows = await client.recoveryOpportunity.findMany({
        where: { status: 'OPEN', OR: identities },
        orderBy: { detectedAt: 'asc' },
      });
      return rows;
    },
    async findById(id) {
      const row = await client.recoveryOpportunity.findUnique({ where: { id } });
      return row ?? null;
    },
    async list(filters) {
      const rows = await client.recoveryOpportunity.findMany({
        where: toOpportunityWhere(filters),
        orderBy: { detectedAt: 'desc' },
        take: 100,
      });
      return rows;
    },
    async count(filters) {
      return client.recoveryOpportunity.count({ where: toOpportunityWhere(filters) });
    },
    async markRecovered({ id, recoveryEventId, resolvedAt }) {
      const row = await client.recoveryOpportunity.update({
        where: { id },
        data: { status: 'RECOVERED', recoveryEventId, resolvedAt },
      });
      return row;
    },
    async summarizeByStatusAndCurrency(merchantId?: string) {
      const grouped = await client.recoveryOpportunity.groupBy({
        by: ['status', 'currency'],
        ...(merchantId !== undefined ? { where: { merchantId } } : {}),
        _count: { _all: true },
        _sum: { amountAtRisk: true },
      });
      return grouped.map((group) => ({
        status: group.status,
        currency: group.currency,
        count: group._count._all,
        totalAmountAtRisk: group._sum.amountAtRisk ?? 0,
      }));
    },
    async countByType(type, merchantId?: string) {
      return client.recoveryOpportunity.count({
        where: { type, ...(merchantId !== undefined ? { merchantId } : {}) },
      });
    },
    async outcomeStatsByType(type) {
      const grouped = await client.recoveryOpportunity.groupBy({
        by: ['status'],
        where: { type },
        _count: { _all: true },
      });
      let total = 0;
      let recovered = 0;
      for (const group of grouped) {
        total += group._count._all;
        if (group.status === 'RECOVERED') {
          recovered += group._count._all;
        }
      }
      return { total, recovered };
    },
  };
}

/**
 * Serialization boundary for the decision JSON columns: Prisma returns
 * JsonValue while the domain works with typed arrays. Everything stored under
 * these keys was written by this store from the same typed shapes, so the
 * assertions below are safe by construction.
 */
function toDecisionRow(row: {
  id: string;
  merchantId: string | null;
  opportunityId: string;
  engineVersion: string;
  score: number;
  priority: RecoveryDecisionRow['priority'];
  confidence: number;
  recommendedAction: RecoveryDecisionRow['recommendedAction'];
  reasons: unknown;
  factors: unknown;
  riskFlags: unknown;
  evaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): RecoveryDecisionRow {
  return {
    ...row,
    reasons: row.reasons as string[],
    factors: row.factors as DecisionFactor[],
    riskFlags: row.riskFlags as DecisionRiskFlagDetail[],
  };
}

function toDecisionJsonInput(data: NewRecoveryDecisionData): {
  reasons: Prisma.InputJsonValue;
  factors: Prisma.InputJsonValue;
  riskFlags: Prisma.InputJsonValue;
} {
  return {
    reasons: data.reasons,
    factors: data.factors as unknown as Prisma.InputJsonValue,
    riskFlags: data.riskFlags as unknown as Prisma.InputJsonValue,
  };
}

export function createPrismaRecoveryDecisionStore(client: PrismaClient): RecoveryDecisionStore {
  return {
    async upsert(data) {
      const json = toDecisionJsonInput(data);
      const row = await client.recoveryDecision.upsert({
        where: {
          opportunityId_engineVersion: {
            opportunityId: data.opportunityId,
            engineVersion: data.engineVersion,
          },
        },
        create: { ...data, ...json },
        update: {
          score: data.score,
          priority: data.priority,
          confidence: data.confidence,
          recommendedAction: data.recommendedAction,
          reasons: json.reasons,
          factors: json.factors,
          riskFlags: json.riskFlags,
          evaluatedAt: data.evaluatedAt,
          merchantId: data.merchantId,
        },
      });
      return toDecisionRow(row);
    },
    async findById(id) {
      const row = await client.recoveryDecision.findUnique({ where: { id } });
      return row ? toDecisionRow(row) : null;
    },
    async findByOpportunityAndEngineVersion(opportunityId, engineVersion) {
      const row = await client.recoveryDecision.findUnique({
        where: { opportunityId_engineVersion: { opportunityId, engineVersion } },
      });
      return row ? toDecisionRow(row) : null;
    },
    async findLatestByOpportunityIds(opportunityIds) {
      if (opportunityIds.length === 0) {
        return [];
      }
      const rows = await client.recoveryDecision.findMany({
        where: { opportunityId: { in: [...opportunityIds] } },
        orderBy: { evaluatedAt: 'desc' },
      });
      return rows.map(toDecisionRow);
    },
    async listAll(args) {
      const where = args.merchantId !== undefined ? { merchantId: args.merchantId } : {};
      const rows = await client.recoveryDecision.findMany({
        where,
        orderBy: { evaluatedAt: 'desc' },
      });
      return rows.map(toDecisionRow);
    },
    async countByPriority(priority, merchantId?: string) {
      return client.recoveryDecision.count({
        where: { priority, ...(merchantId !== undefined ? { merchantId } : {}) },
      });
    },
    async countByRecommendedAction(recommendedAction, merchantId?: string) {
      return client.recoveryDecision.count({
        where: { recommendedAction, ...(merchantId !== undefined ? { merchantId } : {}) },
      });
    },
    async averageConfidence(merchantId?: string) {
      const aggregated = await client.recoveryDecision.aggregate({
        _avg: { confidence: true },
        ...(merchantId !== undefined ? { where: { merchantId } } : {}),
      });
      return aggregated._avg.confidence ?? null;
    },
  };
}

/**
 * Serialization boundary for AI advice (warnings JSON column). All content
 * under this key was written by this store from typed string arrays.
 */
function toAdviceRow(row: {
  id: string;
  merchantId: string | null;
  opportunityId: string;
  decisionId: string;
  provider: string;
  model: string;
  advisorVersion: string;
  promptVersion: string;
  status: AIAdviceStatus;
  summary: string;
  explanation: string;
  nextStep: string;
  customerMessage: string | null;
  operatorMessage: string | null;
  confidence: number;
  warnings: unknown;
  safetyConstrained: boolean;
  decisionFingerprint: string;
  createdAt: Date;
  updatedAt: Date;
}): RecoveryAIAdviceRow {
  return { ...row, warnings: row.warnings as string[] };
}

export function createPrismaRecoveryAIAdviceStore(
  client: PrismaClient
): RecoveryAIAdviceStore {
  return {
    async upsert(data) {
      const row = await client.recoveryAIAdvice.upsert({
        where: {
          decisionId_advisorVersion_model: {
            decisionId: data.decisionId,
            advisorVersion: data.advisorVersion,
            model: data.model,
          },
        },
        create: { ...data, warnings: data.warnings },
        update: {
          status: data.status,
          summary: data.summary,
          explanation: data.explanation,
          nextStep: data.nextStep,
          customerMessage: data.customerMessage,
          operatorMessage: data.operatorMessage,
          confidence: data.confidence,
          warnings: data.warnings,
          safetyConstrained: data.safetyConstrained,
          decisionFingerprint: data.decisionFingerprint,
          merchantId: data.merchantId,
        },
      });
      return toAdviceRow(row);
    },
    async findByDecision({ decisionId, advisorVersion, model }) {
      const row = await client.recoveryAIAdvice.findUnique({
        where: {
          decisionId_advisorVersion_model: { decisionId, advisorVersion, model },
        },
      });
      return row ? toAdviceRow(row) : null;
    },
    async findByDecisionId(decisionId) {
      const row = await client.recoveryAIAdvice.findFirst({
        where: { decisionId },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toAdviceRow(row) : null;
    },
  };
}

export function createPrismaRecoveryExecutionStore(
  client: PrismaClient
): RecoveryExecutionStore {
  return {
    async insert(data: NewRecoveryExecutionData): Promise<RecoveryExecutionRow> {
      const row: RecoveryExecutionRow = await client.recoveryExecution.create({ data });
      return row;
    },
    async findByIdempotencyKey(idempotencyKey) {
      const row = await client.recoveryExecution.findUnique({ where: { idempotencyKey } });
      return row ?? null;
    },
    async findById(id) {
      const row = await client.recoveryExecution.findUnique({ where: { id } });
      return row ?? null;
    },
    async updateStatus(args) {
      const row = await client.recoveryExecution.update({
        where: { id: args.id },
        data: {
          status: args.status,
          ...(args.startedAt !== undefined ? { startedAt: args.startedAt } : {}),
          ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
          ...(args.failureCode !== undefined ? { failureCode: args.failureCode } : {}),
          ...(args.failureReason !== undefined ? { failureReason: args.failureReason } : {}),
        },
      });
      return row;
    },
    // Conditional update establishes ownership atomically: exactly one caller
    // sees count === 1; concurrent racers get null and must stand down.
    async transitionStatus(args) {
      const updated = await client.recoveryExecution.updateMany({
        where: { id: args.id, status: args.from },
        data: {
          status: args.to,
          ...(args.startedAt !== undefined ? { startedAt: args.startedAt } : {}),
          ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
          ...(args.failureCode !== undefined ? { failureCode: args.failureCode } : {}),
          ...(args.failureReason !== undefined ? { failureReason: args.failureReason } : {}),
        },
      });
      if (updated.count !== 1) {
        return null;
      }
      const row = await client.recoveryExecution.findUnique({ where: { id: args.id } });
      return row;
    },
    async setNextAttemptAt({ id, nextAttemptAt }) {
      const row = await client.recoveryExecution.update({
        where: { id },
        data: { nextAttemptAt },
      });
      return row;
    },
    async listByOpportunity(opportunityId) {
      return client.recoveryExecution.findMany({
        where: { opportunityId },
        orderBy: [{ attempt: 'desc' }, { createdAt: 'desc' }],
      });
    },
    async findLatestByOpportunityAndAction(opportunityId, action) {
      const row = await client.recoveryExecution.findFirst({
        where: { opportunityId, action },
        orderBy: [{ attempt: 'desc' }, { createdAt: 'desc' }],
      });
      return row ?? null;
    },
    async findActiveByOpportunity(opportunityId) {
      const ACTIVE: ExecutionStatus[] = ['PENDING', 'AUTHORIZED', 'EXECUTING', 'SUCCEEDED'];
      const row = await client.recoveryExecution.findFirst({
        where: { opportunityId, status: { in: ACTIVE } },
        orderBy: [{ attempt: 'desc' }, { createdAt: 'desc' }],
      });
      return row ?? null;
    },
    async findDuePending({ dueBefore, limit }) {
      return client.recoveryExecution.findMany({
        where: {
          status: 'PENDING',
          OR: [
            { nextAttemptAt: { lte: dueBefore } },
            { AND: [{ nextAttemptAt: null }, { requestedAt: { lte: dueBefore } }] },
          ],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { requestedAt: 'asc' }],
        take: limit,
      });
    },
    async findStalePending({ createdBefore, limit }) {
      return client.recoveryExecution.findMany({
        where: { status: 'PENDING', createdAt: { lt: createdBefore } },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
    },
    async listRecent(filters) {
      return client.recoveryExecution.findMany({
        where: filters.status !== undefined ? { status: filters.status } : undefined,
        orderBy: { createdAt: 'desc' },
        take: filters.limit,
      });
    },
    async listAll(args) {
      const where = args.merchantId !== undefined ? { merchantId: args.merchantId } : {};
      return client.recoveryExecution.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    },
    async countByStatus() {
      const grouped = await client.recoveryExecution.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      return grouped.map((group) => ({ status: group.status, count: group._count._all }));
    },
    async countRetryAttempts(opportunityId) {
      return client.recoveryExecution.count({
        where: { opportunityId, action: 'RETRY', status: { not: 'BLOCKED' } },
      });
    },
  };
}

export function createPrismaAuthenticationStore(
  client: PrismaClient
): import('../domain/authentication.js').AuthenticationStore {
  type AuthStore = import('../domain/authentication.js').AuthenticationStore;
  const store: AuthStore = {
    async findUserByEmail(email) {
      const row = await client.user.findUnique({ where: { email } });
      return row ?? null;
    },
    async createUser(input) {
      return client.user.create({ data: input });
    },
    async findMembershipsByUser(userId) {
      return client.merchantMembership.findMany({ where: { userId } });
    },
    async findMembership(userId, merchantId) {
      return client.merchantMembership.findUnique({
        where: { userId_merchantId: { userId, merchantId } },
      });
    },
    async createMembership(input) {
      return client.merchantMembership.create({ data: input });
    },
    async createSession(input) {
      return client.session.create({ data: input });
    },
    async findActiveSessionByTokenHash(tokenHash, now) {
      const session = await client.session.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
        include: { user: { include: { memberships: true } } },
      });
      if (session === null) {
        return null;
      }
      return {
        session,
        user: { id: session.user.id, email: session.user.email, passwordHash: session.user.passwordHash, createdAt: session.user.createdAt, updatedAt: session.user.updatedAt },
        memberships: session.user.memberships.map((m) => ({ id: m.id, userId: m.userId, merchantId: m.merchantId, role: m.role })),
      };
    },
    async revokeSession(tokenHash) {
      await client.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// Merchant Strategy Memory Store (Phase 11)
// ---------------------------------------------------------------------------

function toMerchantStrategyMemoryRow(row: {
  id: string;
  merchantId: string;
  strategy: MerchantMemoryStrategy;
  failureType: string;
  attempts: number;
  successes: number;
  failures: number;
  blocked: number;
  humanReviews: number;
  totalAmountAttempted: number;
  totalAmountRecovered: number;
  successRate: number;
  recoveryRate: number;
  sampleCount: number;
  confidence: number;
  effectivenessScore: number;
  lastObservedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): MerchantStrategyMemoryRow {
  return {
    id: row.id,
    merchantId: row.merchantId,
    strategy: row.strategy,
    failureType: row.failureType,
    attempts: row.attempts,
    successes: row.successes,
    failures: row.failures,
    blocked: row.blocked,
    humanReviews: row.humanReviews,
    totalAmountAttempted: row.totalAmountAttempted,
    totalAmountRecovered: row.totalAmountRecovered,
    successRate: row.successRate,
    recoveryRate: row.recoveryRate,
    sampleCount: row.sampleCount,
    confidence: row.confidence,
    effectivenessScore: row.effectivenessScore,
    lastObservedAt: row.lastObservedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createPrismaMerchantStrategyMemoryStore(
  client: PrismaClient
): MerchantStrategyMemoryStore {
  return {
    async upsert(data) {
      const existing = await client.merchantStrategyMemory.findUnique({
        where: {
          merchantId_strategy_failureType: {
            merchantId: data.merchantId,
            strategy: data.strategy,
            failureType: data.failureType,
          },
        },
      });

      if (existing !== null) {
        return toMerchantStrategyMemoryRow(existing);
      }

      const row = await client.merchantStrategyMemory.create({ data });
      return toMerchantStrategyMemoryRow(row);
    },

    async updateMetrics(id, metrics) {
      const row = await client.merchantStrategyMemory.update({
        where: { id },
        data: metrics,
      });
      return toMerchantStrategyMemoryRow(row);
    },

    async findById(id) {
      const row = await client.merchantStrategyMemory.findUnique({ where: { id } });
      return row !== null ? toMerchantStrategyMemoryRow(row) : null;
    },

    async findByMerchantAndStrategy(merchantId, strategy, failureType) {
      const row = await client.merchantStrategyMemory.findUnique({
        where: {
          merchantId_strategy_failureType: { merchantId, strategy, failureType },
        },
      });
      return row !== null ? toMerchantStrategyMemoryRow(row) : null;
    },

    async listByMerchant(merchantId) {
      const rows = await client.merchantStrategyMemory.findMany({
        where: { merchantId },
        orderBy: { effectivenessScore: 'desc' },
      });
      return rows.map((row) => toMerchantStrategyMemoryRow(row));
    },

    async getOverview(merchantId) {
      const strategies = await this.listByMerchant(merchantId);

      const totalOutcomes = strategies.reduce((sum, s) => sum + s.sampleCount, 0);
      const totalRecovered = strategies.reduce((sum, s) => sum + s.successes, 0);
      const totalAmountRecovered = strategies.reduce((sum, s) => sum + s.totalAmountRecovered, 0);
      const totalAmountAttempted = strategies.reduce((sum, s) => sum + s.totalAmountAttempted, 0);
      const recoveryRate = totalAmountAttempted > 0 ? totalAmountRecovered / totalAmountAttempted : 0;

      // Find best strategy by effectiveness score
      let bestStrategy: MerchantMemoryStrategy | null = null;
      let bestStrategySuccessRate = 0;
      for (const s of strategies) {
        if (s.sampleCount >= 3 && s.effectivenessScore > bestStrategySuccessRate) {
          bestStrategy = s.strategy;
          bestStrategySuccessRate = s.effectivenessScore;
        }
      }

      // Group by failure type
      const failureTypeMap = new Map<string, { attempts: number; successes: number; bestStrategy: MerchantMemoryStrategy | null; bestRate: number }>();
      for (const s of strategies) {
        const existing = failureTypeMap.get(s.failureType);
        if (existing) {
          existing.attempts += s.attempts;
          existing.successes += s.successes;
          if (s.sampleCount >= 3 && s.effectivenessScore > existing.bestRate) {
            existing.bestStrategy = s.strategy;
            existing.bestRate = s.effectivenessScore;
          }
        } else {
          failureTypeMap.set(s.failureType, {
            attempts: s.attempts,
            successes: s.successes,
            bestStrategy: s.sampleCount >= 3 ? s.strategy : null,
            bestRate: s.sampleCount >= 3 ? s.effectivenessScore : 0,
          });
        }
      }

      const failurePatterns: MerchantMemoryOverview['failurePatterns'] = [];
      for (const [failureType, data] of failureTypeMap) {
        failurePatterns.push({
          failureType,
          attempts: data.attempts,
          successes: data.successes,
          recoveryRate: data.attempts > 0 ? data.successes / data.attempts : 0,
          bestStrategy: data.bestStrategy,
          bestStrategySuccessRate: data.bestRate,
        });
      }

      // Confidence assessment
      let confidence: MerchantMemoryOverview['confidence'] = 'NO_DATA';
      if (totalOutcomes >= 20) {
        confidence = 'SUFFICIENT';
      } else if (totalOutcomes > 0) {
        confidence = 'LOW';
      }

      const lastObservedAt = strategies.reduce<Date | null>((latest, s) => {
        if (s.lastObservedAt === null) return latest;
        if (latest === null || s.lastObservedAt > latest) return s.lastObservedAt;
        return latest;
      }, null);

      return {
        merchantId,
        totalOutcomes,
        totalRecovered,
        totalAmountRecovered,
        recoveryRate,
        bestStrategy,
        bestStrategySuccessRate,
        strategies,
        failurePatterns,
        confidence,
        lastObservedAt,
      };
    },

    async getEvidenceForAI(merchantId) {
      const strategies = await this.listByMerchant(merchantId);
      const totalOutcomes = strategies.reduce((sum, s) => sum + s.sampleCount, 0);
      const totalAmountRecovered = strategies.reduce((sum, s) => sum + s.totalAmountRecovered, 0);
      const totalAmountAttempted = strategies.reduce((sum, s) => sum + s.totalAmountAttempted, 0);
      const overallRecoveryRate = totalAmountAttempted > 0 ? totalAmountRecovered / totalAmountAttempted : 0;

      let confidenceLevel: MerchantMemoryEvidence['confidenceLevel'] = 'NO_DATA';
      if (totalOutcomes >= 20) {
        confidenceLevel = 'SUFFICIENT';
      } else if (totalOutcomes > 0) {
        confidenceLevel = 'LOW';
      }

      return {
        merchantId,
        strategyPerformance: strategies
          .filter((s) => s.sampleCount > 0)
          .map((s) => ({
            strategy: s.strategy,
            failureType: s.failureType,
            attempts: s.attempts,
            successes: s.successes,
            successRate: s.successRate,
            totalAmountRecovered: s.totalAmountRecovered,
            confidence: s.confidence,
          })),
        overallRecoveryRate,
        totalOutcomes,
        confidenceLevel,
      };
    },

    async deleteByMerchant(merchantId) {
      const result = await client.merchantStrategyMemory.deleteMany({
        where: { merchantId },
      });
      return result.count;
    },
  };
}
