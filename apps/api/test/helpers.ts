import { vi } from 'vitest';
import { parseEnv, type AppEnv } from '../src/config/env.js';
import type { DbExecutor } from '../src/lib/database.js';

export function makeTestEnv(overrides: Partial<Record<keyof AppEnv, string>> = {}): AppEnv {
  return parseEnv({
    NODE_ENV: 'test',
    PORT: '4777',
    HOST: '127.0.0.1',
    DATABASE_URL:
      'postgresql://recoveryos:recoveryos_dev@localhost:5432/recoveryos?schema=public',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export type QueryRawMock = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

export interface DbExecutorMock extends DbExecutor {
  $queryRaw: ReturnType<typeof vi.fn<QueryRawMock>>;
}

export function createDbExecutorMock(impl?: QueryRawMock): DbExecutorMock {
  return {
    $queryRaw: vi.fn<QueryRawMock>(impl ?? (async () => [{ ok: 1 }])),
  };
}
