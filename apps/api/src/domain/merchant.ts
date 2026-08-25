import { z } from 'zod';

export interface Merchant {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MerchantRow {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export const createMerchantSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required.').max(120, 'Name is too long.'),
  })
  .strict();

export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;

export const listMerchantsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type ListMerchantsQuery = z.infer<typeof listMerchantsQuerySchema>;

export function toMerchant(row: MerchantRow): Merchant {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface MerchantStore {
  create(args: { data: { name: string } }): Promise<MerchantRow>;
  findUnique(args: { where: { id: string } }): Promise<MerchantRow | null>;
  findMany(args?: { take?: number; skip?: number }): Promise<MerchantRow[]>;
  count(): Promise<number>;
}
