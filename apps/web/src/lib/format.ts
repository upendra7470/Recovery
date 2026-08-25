const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatInr(amount: number): string {
  return inrFormatter.format(amount);
}

export function formatPercent(value: number, fractionDigits = 0): string {
  return `${value.toFixed(fractionDigits)}%`;
}

/** Minor-unit exponents for supported currencies; most use two digits. */
const MINOR_UNIT_EXPONENTS: Record<string, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
};

/**
 * Formats an amount stored in the provider's smallest currency unit
 * (e.g. paise for INR). Currencies are never mixed — one call per currency.
 */
export function formatMinorAmount(amountMinor: number, currency: string): string {
  const exponent = MINOR_UNIT_EXPONENTS[currency] ?? 2;
  const factor = 10 ** exponent;
  const major = amountMinor / factor;
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: Math.min(exponent, 2),
    }).format(major);
  } catch {
    return `${major.toFixed(exponent)} ${currency}`;
  }
}
