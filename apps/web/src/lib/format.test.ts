import { describe, expect, it } from 'vitest';
import { formatInr, formatPercent } from './format';

describe('formatInr', () => {
  it('formats zero without decimals', () => {
    expect(formatInr(0)).toBe('₹0');
  });

  it('uses Indian digit grouping for large amounts', () => {
    expect(formatInr(150000)).toBe('₹1,50,000');
  });

  it('rounds fractional amounts to whole rupees', () => {
    expect(formatInr(1234.56)).toBe('₹1,235');
  });
});

describe('formatPercent', () => {
  it('formats whole percentages by default', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(37.4)).toBe('37%');
  });

  it('supports explicit fraction digits', () => {
    expect(formatPercent(12.5, 1)).toBe('12.5%');
  });
});
