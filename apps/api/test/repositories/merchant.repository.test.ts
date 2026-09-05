import { describe, expect, it, vi } from 'vitest';
import type { MerchantRow, MerchantStore } from '../../src/domain/merchant.js';
import { NotFoundError, ValidationError } from '../../src/lib/errors.js';
import { MerchantRepository } from '../../src/repositories/merchant.repository.js';
import { MerchantService } from '../../src/services/merchant.service.js';

function row(overrides: Partial<MerchantRow> = {}): MerchantRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Acme Retail',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function createStore(overrides: Partial<MerchantStore> = {}): MerchantStore & {
  create: ReturnType<typeof vi.fn>;
} {
  const store: MerchantStore = {
    create: vi.fn(async () => row()),
    findUnique: vi.fn(async () => null),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    upsertById: vi.fn(async (args: { id: string; name: string }) => row({ id: args.id, name: args.name })),
    deleteById: vi.fn(async () => true),
    ...overrides,
  };
  return store as MerchantStore & { create: ReturnType<typeof vi.fn> };
}

describe('MerchantRepository', () => {
  it('creates merchants and maps persistence rows to domain objects', async () => {
    const store = createStore({
      create: vi.fn(async ({ data }: { data: { name: string } }) =>
        row({ name: data.name })
      ),
    });
    const repository = new MerchantRepository(store);

    const merchant = await repository.create({ name: 'Acme Retail' });

    expect(store.create).toHaveBeenCalledWith({ data: { name: 'Acme Retail' } });
    expect(merchant).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Acme Retail',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(merchant.createdAt).toBeInstanceOf(Date);
  });

  it('returns null for an unknown id without throwing', async () => {
    const store = createStore({ findUnique: vi.fn(async () => null) });
    const repository = new MerchantRepository(store);

    await expect(repository.findById('nope')).resolves.toBeNull();
    expect(store.findUnique).toHaveBeenCalledWith({ where: { id: 'nope' } });
  });

  it('lists merchants applying pagination from the query object', async () => {
    const store = createStore({
      findMany: vi.fn(async () => [row(), row({ id: '22222222-2222-4222-8222-222222222222' })]),
    });
    const repository = new MerchantRepository(store);

    const merchants = await repository.list({ limit: 50, offset: 10 });

    expect(store.findMany).toHaveBeenCalledWith({ take: 50, skip: 10 });
    expect(merchants).toHaveLength(2);
    expect(merchants.every((m) => typeof m.id === 'string')).toBe(true);
  });

  it('counts via the underlying store', async () => {
    const store = createStore({ count: vi.fn(async () => 7) });

    await expect(new MerchantRepository(store).count()).resolves.toBe(7);
  });
});

describe('MerchantService', () => {
  function serviceWithStore(store: MerchantStore) {
    return new MerchantService(new MerchantRepository(store));
  }

  it('validates input before creating a merchant', async () => {
    const store = createStore();

    await expect(serviceWithStore(store).createMerchant({ name: '' })).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(
      serviceWithStore(store).createMerchant({ name: 'Acme', extra: true })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.create).not.toHaveBeenCalled();

    await expect(
      serviceWithStore(store).createMerchant({ name: '  Acme Retail ' })
    ).resolves.toMatchObject({ name: 'Acme Retail' });
  });

  it('throws NotFoundError for missing merchants', async () => {
    const service = serviceWithStore(createStore({ findUnique: vi.fn(async () => null) }));

    await expect(service.getMerchant('missing-id')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('propagates unexpected store failures untouched', async () => {
    const store = createStore({
      count: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    });

    await expect(serviceWithStore(store).listMerchants({ limit: 5, offset: 0 })).resolves.toEqual([]);
    await expect(
      new MerchantRepository(store).count()
    ).rejects.toThrow('connection refused');
  });

  it('validates pagination input for listings', async () => {
    const store = createStore();

    await expect(
      serviceWithStore(store).listMerchants({ limit: '9999' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(serviceWithStore(store).listMerchants({ limit: '5' })).resolves.toEqual([]);
  });
});
