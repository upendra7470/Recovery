import type { AppEnv } from '../config/env.js';
import type { AppDatabase } from '../lib/database.js';
import type { RecoveryOpportunityRepository } from '../repositories/recovery-opportunity.repository.js';
import type { RecoveryDecisionRepository } from '../repositories/recovery-decision.repository.js';
import type { RecoveryDecisionService } from '../services/recovery-decision.service.js';
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
  }

  interface FastifyRequest {
    /** Exact raw request bytes, captured before JSON parsing (webhook signatures). */
    rawBody?: Buffer;
  }
}
