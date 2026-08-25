import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMerchantSchema, listMerchantsQuerySchema } from '../../src/domain/merchant.js';
import { ValidationError } from '../../src/lib/errors.js';
import { parseWith } from '../../src/validation/parse.js';

describe('parseWith', () => {
  const schema = z.object({ limit: z.coerce.number().int().min(1) }).strict();

  it('returns parsed and coerced data on success', () => {
    expect(parseWith(schema, { limit: '5' })).toEqual({ limit: 5 });
  });

  it('throws a ValidationError with issue details on failure', () => {
    try {
      parseWith(schema, { limit: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.statusCode).toBe(422);
      expect(validationError.code).toBe('VALIDATION_ERROR');
      const issues = validationError.details?.issues as
        | { path: string; message: string }[]
        | undefined;
      expect(Array.isArray(issues)).toBe(true);
      expect(issues?.[0]?.path).toBe('limit');
      expect(typeof issues?.[0]?.message).toBe('string');
    }
  });

  it('reports unknown keys when the schema is strict', () => {
    try {
      parseWith(schema, { limit: '1', extra: true });
      expect.unreachable();
    } catch (error) {
      const issues = (error as ValidationError).details?.issues as
        | { path: string; message: string }[]
        | undefined;
      expect(issues?.some((issue) => issue.message.includes('Unrecognized key'))).toBe(
        true
      );
    }
  });
});

describe('createMerchantSchema', () => {
  it('trims whitespace around the name', () => {
    expect(createMerchantSchema.parse({ name: '  Acme Retail  ' })).toEqual({
      name: 'Acme Retail',
    });
  });

  it('rejects a name that is empty after trimming', () => {
    expect(() => createMerchantSchema.parse({ name: '   ' })).toThrow();
  });

  it('rejects names longer than the maximum', () => {
    const longName = 'x'.repeat(121);
    expect(() => createMerchantSchema.parse({ name: longName })).toThrow();
  });
});

describe('listMerchantsQuerySchema', () => {
  it('applies defaults for pagination', () => {
    expect(listMerchantsQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it('coerces numeric strings and bounds the limit', () => {
    expect(listMerchantsQuerySchema.parse({ limit: '50', offset: '10' })).toEqual({
      limit: 50,
      offset: 10,
    });
    expect(listMerchantsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(listMerchantsQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
  });
});
