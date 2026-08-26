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
    .url()
    .refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      { message: 'Must be a PostgreSQL connection string' }
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
  AI_API_KEY: emptyToUndefined(z.string().min(1).optional()),
  AI_BASE_URL: emptyToUndefined(z.url().optional()),
  AI_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(5000),
  AI_ADVISOR_VERSION: z.string().regex(/^v\d+$/).default('v1'),
}).superRefine((env, ctx) => {
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
    super(`Invalid environment configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
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
