import { describe, expect, it } from 'vitest';
import { toJsonValue } from '../../src/lib/json.js';

describe('toJsonValue', () => {
  it('passes through JSON primitives at the root', () => {
    expect(toJsonValue('text')).toBe('text');
    expect(toJsonValue(42)).toBe(42);
    expect(toJsonValue(true)).toBe(true);
  });

  it('returns undefined for non-representable root values', () => {
    expect(toJsonValue(null)).toBeUndefined();
    expect(toJsonValue(undefined)).toBeUndefined();
    expect(toJsonValue(Number.NaN)).toBeUndefined();
    expect(toJsonValue(new Date())).toBeUndefined();
    expect(toJsonValue(new Map())).toBeUndefined();
    expect(toJsonValue(new Set([1]))).toBeUndefined();
  });

  it('preserves nested nulls inside objects and arrays', () => {
    const converted = toJsonValue({ a: null, b: [1, null, 'x'] });
    expect(converted).toEqual({ a: null, b: [1, null, 'x'] });
  });

  it('drops undefined object properties like JSON.stringify', () => {
    expect(toJsonValue({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it('converts undefined array items to null like JSON.stringify', () => {
    expect(toJsonValue([1, undefined])).toEqual([1, null]);
  });

  it('rejects roots containing non-finite numbers', () => {
    expect(toJsonValue({ amount: Number.POSITIVE_INFINITY })).toBeUndefined();
  });

  it('converts deeply nested structures', () => {
    const input = {
      event: 'payment.captured',
      payload: {
        payment: {
          id: 'pay_1',
          notes: { nested: ['a', 2, false, null] },
        },
      },
    };
    expect(toJsonValue(input)).toEqual(input);
  });
});
