import type { Merchant } from '../domain/merchant.js';
import { createMerchantSchema, listMerchantsQuerySchema } from '../domain/merchant.js';
import { NotFoundError } from '../lib/errors.js';
import type { MerchantRepository } from '../repositories/merchant.repository.js';
import { parseWith } from '../validation/parse.js';

export class MerchantService {
  constructor(private readonly repository: MerchantRepository) {}

  async createMerchant(input: unknown): Promise<Merchant> {
    const data = parseWith(createMerchantSchema, input);
    return this.repository.create(data);
  }

  async getMerchant(id: string): Promise<Merchant> {
    const merchant = await this.repository.findById(id);
    if (!merchant) {
      throw new NotFoundError('Merchant');
    }
    return merchant;
  }

  async listMerchants(query: unknown): Promise<Merchant[]> {
    const parsedQuery = parseWith(listMerchantsQuerySchema, query);
    return this.repository.list(parsedQuery);
  }
}
