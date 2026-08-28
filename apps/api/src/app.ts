import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { loadEnv, type AppEnv } from './config/env.js';
import { startRecoveryAutomation } from './runtime/recovery-automation.js';
import type { AppDatabase } from './lib/database.js';
import { createLoggerOptions } from './lib/logger.js';
import { createAppDatabase, createPrismaClient, type PrismaClient } from './lib/prisma.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerSecurityHeaders } from './plugins/security-headers.js';
import { opportunityRoutes } from './routes/opportunities.js';
import { decisionRoutes } from './routes/decisions.js';
import { executionRoutes } from './routes/executions.js';
import { operationsRoutes } from './routes/operations.js';
import { demoRoutes } from './routes/demo.js';
import { authRoutes } from './routes/auth.js';
import { authenticationPlugin } from './plugins/authentication.js';
import { healthRoutes } from './routes/health.js';
import { readyRoutes } from './routes/ready.js';
import { webhookRoutes } from './routes/webhooks.js';
import { RecoveryOpportunityRepository } from './repositories/recovery-opportunity.repository.js';
import { RecoveryDecisionRepository } from './repositories/recovery-decision.repository.js';
import { AuthenticationService } from './auth/authentication.service.js';
import { RecoveryDecisionService } from './services/recovery-decision.service.js';
import { RecoveryAIAdvisorService } from './services/recovery-ai-advisor.service.js';
import { RecoveryExecutionService } from './services/recovery-execution.service.js';
import { RecoveryOperationScheduler } from './services/recovery-operation-scheduler.service.js';
import { RecoveryOperationsService } from './services/recovery-operations.service.js';
import { RazorpayRetryAdapter } from './execution/providers/razorpay-retry.adapter.js';
import type { RecoveryExecutionProvider } from './domain/recovery-execution.js';
import { RecoveryExecutionRepository } from './repositories/recovery-execution.repository.js';
import { OpenAICompatibleAdvisor } from './ai/providers/openai-compatible.js';
import {
  createDefaultDetectionRules,
  RevenueLeakageDetector,
} from './detection/revenue-leakage.detector.js';
import { RevenueLeakageService } from './services/revenue-leakage.service.js';

export interface BuildAppOptions {
  env?: AppEnv;
  /** Inject a database implementation (tests); defaults to a real Prisma client. */
  db?: AppDatabase;
  /** Inject an execution provider (tests); defaults to the env-configured adapter. */
  executionProvider?: RecoveryExecutionProvider;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? loadEnv();

  let db: AppDatabase;
  let closeDatabase: () => Promise<void>;
  if (options.db) {
    db = options.db;
    closeDatabase = async () => {};
  } else {
    const client: PrismaClient = createPrismaClient(env.DATABASE_URL);
    db = createAppDatabase(client);
    closeDatabase = async () => {
      await client.$disconnect();
    };
  }

  const app = Fastify({
    logger: createLoggerOptions(env),
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: false,
  });

  app.decorate('config', env);
  app.decorate('db', db);
  app.decorate(
    'authService',
    new AuthenticationService(db.auth, { sessionTtlHours: env.AUTH_SESSION_TTL_HOURS }, app.log)
  );
  await app.register(authenticationPlugin, {
    enabled: env.AUTH_ENABLED,
    cookieSecure: env.AUTH_COOKIE_SECURE,
    sessionTtlHours: env.AUTH_SESSION_TTL_HOURS,
    allowedWebOrigin: env.AUTH_ALLOWED_WEB_ORIGIN,
  });
  app.decorate('opportunities', new RecoveryOpportunityRepository(db.recoveryOpportunity));
  const decisionRepository = new RecoveryDecisionRepository(db.recoveryDecision);
  app.decorate('decisions', decisionRepository);
  const decisionService = new RecoveryDecisionService(
    app.opportunities,
    decisionRepository,
    db.paymentEvent,
    { windowMs: env.DETECTION_WINDOW_HOURS * 60 * 60 * 1000 }
  );
  app.decorate('decisionService', decisionService);

  // AI advisory layer (Phase 5): constructed only when enabled; every failure
  // path degrades to an explicit unavailable state inside the service.
  const advisor = env.AI_ENABLED
    ? new OpenAICompatibleAdvisor({
        provider: env.AI_PROVIDER ?? 'openai-compatible',
        model: env.AI_MODEL ?? '',
        apiKey: env.AI_API_KEY ?? '',
        baseUrl: env.AI_BASE_URL ?? '',
        timeoutMs: env.AI_TIMEOUT_MS,
      })
    : null;
  app.decorate(
    'aiAdvisorService',
    new RecoveryAIAdvisorService(
      decisionService,
      db.recoveryAIAdvice,
      advisor,
      {
        enabled: env.AI_ENABLED,
        provider: env.AI_PROVIDER ?? 'openai-compatible',
        model: env.AI_MODEL ?? 'unavailable',
        advisorVersion: env.AI_ADVISOR_VERSION,
      },
      app.log
    )
  );

  // Controlled recovery execution (Phase 6): disabled by default. The
  // provider is constructed only when Razorpay credentials are configured;
  // otherwise the adapter deterministically reports not_configured.
  const executionProvider =
    options.executionProvider ??
    (env.RECOVERY_EXECUTION_PROVIDER === 'razorpay'
      ? new RazorpayRetryAdapter({
          keyId: env.RAZORPAY_KEY_ID,
          keySecret: env.RAZORPAY_KEY_SECRET,
          baseUrl: env.RAZORPAY_BASE_URL,
          timeoutMs: env.RECOVERY_EXECUTION_TIMEOUT_MS,
        })
      : null);
  app.decorate(
    'executionService',
    new RecoveryExecutionService(
      app.opportunities,
      decisionService,
      new RecoveryExecutionRepository(db.recoveryExecution),
      db.paymentEvent,
      executionProvider,
      {
        enabled: env.RECOVERY_EXECUTION_ENABLED,
        minConfidence: env.RECOVERY_EXECUTION_MIN_CONFIDENCE,
        maxRetries: env.RECOVERY_EXECUTION_MAX_RETRIES,
      },
      app.log
    )
  );

  // Phase 7: recovery operations & automation. The in-process scheduler is a
  // replaceable runtime around the SAME execution pipeline; when automation
  // is disabled nothing is scheduled and no timers run.
  const executionRepository = new RecoveryExecutionRepository(db.recoveryExecution);
  const automationConfig = {
    maxAttempts: env.RECOVERY_MAX_ATTEMPTS,
    backoffSeconds: env.RECOVERY_RETRY_BACKOFF_SECONDS,
    maxAgeHours: env.RECOVERY_OPERATION_MAX_AGE_HOURS,
    batchSize: 25,
  };
  app.decorate('operationsService', new RecoveryOperationsService(
    executionRepository,
    app.opportunities,
    decisionService,
    {
      automationEnabled: env.RECOVERY_AUTOMATION_ENABLED,
      providerConfigured: executionProvider !== null,
      defaultListLimit: 100,
    },
    app.log
  ));
  const operationScheduler = new RecoveryOperationScheduler(
    app.opportunities,
    decisionService,
    executionRepository,
    app.executionService,
    automationConfig,
    app.log
  );
  if (env.RECOVERY_AUTOMATION_ENABLED) {
    startRecoveryAutomation(operationScheduler, env.RECOVERY_AUTOMATION_TICK_SECONDS, app.log, app);
  }

  // Phase 11: Demo mode — detection service for synthetic scenarios
  const detector = new RevenueLeakageDetector(createDefaultDetectionRules());
  const leakageService = new RevenueLeakageService(
    detector,
    app.opportunities,
    app.db.paymentEvent,
    { windowMs: env.DETECTION_WINDOW_HOURS * 60 * 60 * 1000 }
  );
  app.decorate('leakageService', leakageService);

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  registerSecurityHeaders(app);
  registerErrorHandler(app);

  // CORS for browser client components (e.g., demo mode controls)
  // In development, reflect the request origin. In production, restrict to configured origins.
  const allowedOrigins = [
    env.NEXT_PUBLIC_APP_URL,
    env.AUTH_ALLOWED_WEB_ORIGIN,
  ].filter((url): url is string => url !== undefined);

  await app.register(cors, {
    origin: env.NODE_ENV === 'development' ? true : (allowedOrigins.length > 0 ? allowedOrigins : false),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'x-request-id'],
    credentials: true,
    maxAge: 86400,
  });

  await app.register(authRoutes);
  await app.register(healthRoutes);
  await app.register(readyRoutes);
  await app.register(webhookRoutes);
  await app.register(opportunityRoutes);
  await app.register(decisionRoutes);
  await app.register(executionRoutes);
  await app.register(operationsRoutes);
  await app.register(demoRoutes);

  app.addHook('onClose', async () => {
    await closeDatabase();
  });

  return app;
}
