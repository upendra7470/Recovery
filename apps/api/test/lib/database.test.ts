import { describe, expect, it } from 'vitest';
import { checkDatabase, withTimeout, type DbExecutor } from '../../src/lib/database.js';

function executorWith(
  impl: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
): DbExecutor {
  return { $queryRaw: impl };
}

describe('withTimeout', () => {
  it('resolves when the promise settles before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok');
  });

  it('rejects when the promise exceeds the timeout', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 500));
    await expect(withTimeout(slow, 20)).rejects.toThrow(/Timed out after 20ms/);
  });
});

describe('checkDatabase', () => {
  it('reports up when the database responds', async () => {
    const db = executorWith(async () => [{ ok: 1 }]);
    await expect(checkDatabase(db)).resolves.toEqual({ status: 'up' });
  });

  it('reports down with the failure reason when the query rejects', async () => {
    const db = executorWith(async () => {
      throw new Error('connection refused');
    });
    const result = await checkDatabase(db);
    expect(result.status).toBe('down');
    if (result.status === 'down') {
      expect(result.reason).toContain('connection refused');
    }
  });

  it('reports down when the query hangs past the timeout', async () => {
    const db = executorWith(
      () =>
        new Promise<unknown>((resolve) => {
          setTimeout(resolve, 2_000);
        })
    );
    const result = await checkDatabase(db, 25);
    expect(result.status).toBe('down');
    if (result.status === 'down') {
      expect(result.reason).toMatch(/Timed out/);
    }
  });

  it('stringifies non-Error rejections', async () => {
    const boom: unknown = 'boom';
    const db = executorWith(async () => {
      throw boom;
    });
    const result = await checkDatabase(db);
    expect(result.status).toBe('down');
    if (result.status === 'down') {
      expect(result.reason).toBe('boom');
    }
  });

  it('executes a trivial liveness query through the tag interface', async () => {
    let receivedQuery: string | undefined;
    const db = executorWith(async (strings) => {
      receivedQuery = strings.join('');
      return [];
    });
    await checkDatabase(db);
    expect(receivedQuery).toContain('SELECT 1');
  });
});
