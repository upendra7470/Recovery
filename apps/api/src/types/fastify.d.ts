import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../lib/database.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';
import type { RecoveryDecisionRepository } from '../repositories/recovery-decision.repository.js';
import type { RecoveryDecisionService } from '../services/recovery-decision.service.js';
import type { RecoveryAIAdvisorService } from '../services/recovery-ai-advisor.service.js';
import type { RecoveryExecutionService } from '../services/recovery-execution.service.js';
import type { RecoveryOperationsService } from '../services/recovery-operations.service.js';
import type { RevenueLeakageService } from '../services/revenue-leakage.service.js';
import type { MerchantMemoryService } from '../services/merchant-memory.service.js';
import type { DashboardService } from '../services/dashboard.service.js';
import type { JudgeModeService } from '../services/judge-mode.service.js';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppEnv;
    db: AppDatabase;
    /** Shared persistence facade for revenue recovery opportunities. */
    opportunities: RecoveryOpportunityRepository;
    /** Shared persistence facade for recovery decisions. */
    decisions: RecoveryDecisionRepository;
    /** Decision engine orchestration (evaluate/get decisions). */
    decisionService: RecoveryDecisionService;
    /** Advisory AI intelligence layer (never mutates deterministic decisions). */
    aiAdvisorService: RecoveryAIAdvisorService;
    /** Controlled recovery execution orchestration (safety-gated). */
    executionService: RecoveryExecutionService;
    /** Observational operations surface (overview, execution feed, detail). */
    operationsService: RecoveryOperationsService;
    /** Revenue leakage detection service (Phase 3). */
    leakageService: RevenueLeakageService;
    /** Adaptive merchant memory service (Phase 11). */
    merchantMemoryService: MerchantMemoryService;
    /** Merchant dashboard aggregation service (Phase 14). */
    dashboardService: DashboardService;
    /** Judge mode scenario orchestration service (Phase 15). */
    judgeModeService: JudgeModeService;
  }

  interface FastifyRequest {
    /** Exact raw request bytes, captured before JSON parsing (webhook signatures). */
    rawBody?: Buffer;
  }
}
