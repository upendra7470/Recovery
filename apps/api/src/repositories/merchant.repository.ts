import type {
  CreateMerchantInput,
  ListMerchantsQuery,
  Merchant,
  MerchantStore,
} from '../domain/merchant.js';
import { toMerchant } from '../domain/merchant.js';

export class MerchantRepository {
  constructor(private readonly store: MerchantStore) {}

  async create(input: CreateMerchantInput): Promise<Merchant> {
    const row = await this.store.create({ data: { name: input.name } });
    return toMerchant(row);
  }

  async findById(id: string): Promise<Merchant | null> {
    const row = await this.store.findUnique({ where: { id } });
    return row ? toMerchant(row) : null;
  }

  async list(query: ListMerchantsQuery): Promise<Merchant[]> {
    const rows = await this.store.findMany({ take: query.limit, skip: query.offset });
    return rows.map(toMerchant);
  }

  async count(): Promise<number> {
    return this.store.count();
  }
}
