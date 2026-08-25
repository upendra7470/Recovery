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
});

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
