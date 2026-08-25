export type DbQueryTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export interface DbExecutor {
  $queryRaw: DbQueryTag;
  $disconnect?(): Promise<void>;
}

export interface DbCheckOk {
  status: 'up';
}

export interface DbCheckFailed {
  status: 'down';
  reason: string;
}

export type DbCheckResult = DbCheckOk | DbCheckFailed;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function checkDatabase(db: DbExecutor, timeoutMs = 2000): Promise<DbCheckResult> {
  try {
    await withTimeout(db.$queryRaw`SELECT 1`, timeoutMs);
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', reason: error instanceof Error ? error.message : String(error) };
  }
}
