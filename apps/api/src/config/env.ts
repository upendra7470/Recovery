import { z } from 'zod';

export const nodeEnvSchema = z.enum(['development', 'test', 'production']);

export const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

/**
 * Strict boolean env parsing: z.coerce.boolean() would treat the string
 * "false" as true, so feature flags parse only exact "true"/"false".
 */
function booleanFlag(defaultValue: boolean) {
  return z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((value) => value === 'true');
}

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .refine(
      (value) =>
        value.startsWith('postgresql://') ||
        value.startsWith('postgres://') ||
        value.startsWith('file:'),
      { message: 'Must be a PostgreSQL connection string or SQLite file: URL' }
    ),
  LOG_LEVEL: logLevelSchema.default('info'),
  // Optional at the config layer so existing deployments/tests keep working;
  // the webhook endpoint fails closed with a server error when it is unset.
  RAZORPAY_WEBHOOK_SECRET: emptyToUndefined(z.string().min(1).optional()),
  DEFAULT_TEST_PAYMENT_ACCOUNT_ID: emptyToUndefined(z.string().uuid().optional()),
  // Detection window (hours) used by revenue leakage rules to correlate
  // failures with subsequent successful payments.
  DETECTION_WINDOW_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  // ---------------------------------------------------------------------------
  // AI Recovery Intelligence (Phase 5) — advisory layer; disabled by default.
  // The deterministic decision engine remains authoritative for safety.
  // ---------------------------------------------------------------------------
  AI_ENABLED: booleanFlag(false),
  /** Informational provider label persisted with advice (e.g. "openai-compatible"). */
  AI_PROVIDER: emptyToUndefined(z.string().min(1).max(64).optional()),
  AI_MODEL: emptyToUndefined(z.string().min(1).max(128).optional()),
  AI_API_KEY: emptyToUndefined(z.string().min(8, 'AI_API_KEY must be at least 8 characters').optional()),
  AI_BASE_URL: emptyToUndefined(z.url().optional()),
  AI_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(5000),
  AI_ADVISOR_VERSION: z.string().regex(/^v\d+$/).default('v1'),
  // ---------------------------------------------------------------------------
  // Controlled recovery execution (Phase 6) — DISABLED by default. The
  // deterministic decision engine remains authoritative; only RETRY is ever
  // executable and every request passes the safety gate.
  // ---------------------------------------------------------------------------
  RECOVERY_EXECUTION_ENABLED: booleanFlag(false),
  RECOVERY_EXECUTION_MIN_CONFIDENCE: z.coerce.number().int().min(0).max(100).default(60),
  RECOVERY_EXECUTION_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
  RECOVERY_EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(5000),
  RECOVERY_EXECUTION_PROVIDER: emptyToUndefined(z.enum(['razorpay']).optional()),
  // Razorpay API credentials for recovery execution. The adapter uses
  // Basic Auth with key_id:key_secret against https://api.razorpay.com/v1/orders.
  // These are SEPARATE from the webhook secret (RAZORPAY_WEBHOOK_SECRET above).
  /** Razorpay Key ID (e.g. rzp_test_xxxxx). Required when provider=razorpay. */
  RAZORPAY_KEY_ID: emptyToUndefined(z.string().min(1).optional()),
  /** Razorpay Key Secret. Required when provider=razorpay. NEVER logged or persisted. */
  RAZORPAY_KEY_SECRET: emptyToUndefined(z.string().min(1).optional()),
  /** Razorpay API base URL override; defaults to https://api.razorpay.com. */
  RAZORPAY_BASE_URL: emptyToUndefined(z.url().optional()),
  // ---------------------------------------------------------------------------
  // Recovery operations & automation (Phase 7) -- DISABLED by default. The
  // scheduler reuses the Phase 6 execution pipeline and safety gate verbatim.
  // ---------------------------------------------------------------------------
  RECOVERY_AUTOMATION_ENABLED: booleanFlag(false),
  RECOVERY_AUTOMATION_TICK_SECONDS: z.coerce.number().int().min(5).max(3600).default(30),
  /** Per-opportunity cap on automated retry attempts. */
  RECOVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  /** PENDING executions older than this are deterministically CANCELLED. */
  RECOVERY_OPERATION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(8760).default(72),
  /** Deterministic exponential backoff base between automated attempts. */
  RECOVERY_RETRY_BACKOFF_SECONDS: z.coerce.number().int().min(1).max(86400).default(300),
  // ---------------------------------------------------------------------------
  // Authentication & tenant isolation (Phase 8) -- opt-in for existing
  // deployments; MANDATORY in production (fail-fast below).
  // ---------------------------------------------------------------------------
  AUTH_ENABLED: booleanFlag(false),
  AUTH_SESSION_SECRET: emptyToUndefined(z.string().min(32).optional()),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  AUTH_COOKIE_SECURE: booleanFlag(true),
  /** When set, auth endpoints accept credentialed CORS from this origin only. */
  AUTH_ALLOWED_WEB_ORIGIN: emptyToUndefined(z.url().optional()),
  // ---------------------------------------------------------------------------
  // Demo Mode (Phase 11) -- DISABLED by default. Provides deterministic
  // synthetic scenarios for demonstration purposes. Never uses real customer
  // data or production payments.
  // ---------------------------------------------------------------------------
  DEMO_MODE_ENABLED: booleanFlag(false),
  // ---------------------------------------------------------------------------
  // Cross-origin resource sharing (CORS) origin for browser client components.
  // ---------------------------------------------------------------------------
  NEXT_PUBLIC_APP_URL: emptyToUndefined(z.url().optional()),
}).superRefine((env, ctx) => {
  if (env.AUTH_ENABLED && env.AUTH_SESSION_SECRET === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_SESSION_SECRET'],
      message: 'Required when AUTH_ENABLED=true (minimum 32 characters)',
    });
  }
  if (!env.AUTH_ENABLED && env.NODE_ENV === 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['AUTH_ENABLED'],
      message: 'Authentication must be enabled in production',
    });
  }
  if (env.AI_ENABLED) {
    for (const field of ['AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL'] as const) {
      if (env[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `Required when AI_ENABLED=true`,
        });
      }
    }
  }
  // Razorpay provider requires API credentials for Basic Auth.
  if (env.RECOVERY_EXECUTION_PROVIDER === 'razorpay') {
    for (const field of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'] as const) {
      if (env[field] === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `Required when RECOVERY_EXECUTION_PROVIDER=razorpay`,
        });
      }
    }
  }
});

function emptyToUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value === 'string' && value.trim() === '') {
      return undefined;
    }
    return value;
  }, schema);
}

export type AppEnv = z.infer<typeof envSchema>;
export type RawEnvInput = NodeJS.ProcessEnv | Record<string, string | undefined>;

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    const sanitized = issues.map((issue) =>
      issue.replace(/postgresql:\/\/[^\s]+/gi, 'postgresql://[REDACTED]').replace(/postgres:\/\/[^\s]+/gi, 'postgres://[REDACTED]')
    );
    super(`Invalid environment configuration: ${sanitized.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = sanitized;
  }
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.length > 0 ? path.map(String).join('.') : '(root)';
}

export function parseEnv(input: RawEnvInput): AppEnv {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`
    );
    throw new ConfigError(issues);
  }
  return result.data;
}

export function loadEnv(input: RawEnvInput = process.env): AppEnv {
  return parseEnv(input);
}
